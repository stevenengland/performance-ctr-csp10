<?php

declare(strict_types=1);

namespace Performance\Tests\Integration;

use DateTimeImmutable;
use Performance\Domain\DataRevision;
use Performance\Domain\Interval;
use Performance\Domain\Scoreboard;
use Performance\Domain\Span;
use Performance\Domain\Timestamp;
use Performance\Http\Instant;
use Performance\Tests\Support\DatabaseTestCase;
use PHPUnit\Framework\Attributes\DataProvider;
use Psr\Http\Message\ResponseInterface;

/**
 * The days with drinks that count, at `GET /api/scoreboard/days`: the runs of consecutive
 * quarter hours with a verified entry, for a bounded window or all time, with their ETag.
 */
final class ScoreboardDaysTest extends DatabaseTestCase
{
    private const START = '2026-11-14T20:00:00Z';
    /** November 2026 in Berlin: 2026-10-31T23:00Z to 2026-11-30T23:00Z. */
    private const NOVEMBER = 'from=2026-11-01T00:00:00%2B01:00&to=2026-12-01T00:00:00%2B01:00';

    private string $session;
    private int $entries = 0;

    protected function setUp(): void
    {
        parent::setUp();
        $this->session = $this->signIn();
        foreach (['Daniel', 'Anna', 'Ben'] as $name) {
            $this->send('POST', '/api/persons', ['name' => $name], $this->session);
        }
        $this->send('POST', '/api/drinks', ['name' => 'Bier', 'points' => 1], $this->session);
        $this->send('POST', '/api/drinks', ['name' => 'Aperol', 'points' => 2.5], $this->session);
    }

    public function testListsTheQuarterHoursWithAVerifiedEntryAsSpansAndLeavesPendingEntriesOut(): void
    {
        $this->add(1, 2);                  // 2026-11-14 20:00 UTC
        $this->clock->advance('P1D');      // 2026-11-15 20:00 UTC
        $this->add(1, 1);
        $this->clock->advance('PT14M59S'); // 20:14:59, the same quarter hour
        $this->add(2, 2);
        $this->clock->advance('PT1S');     // 20:15:00, the next one
        $this->add(3, 1);
        $this->clock->advance('PT1H');     // 21:15, only pending
        $this->record(1, 1);

        $response = $this->days();

        self::assertSame(200, $response->getStatusCode(), (string) $response->getBody());
        self::assertSame(
            ['spans' => [self::span('2026-11-14T20:00', '2026-11-14T20:15'), self::span('2026-11-15T20:00', '2026-11-15T20:30')]],
            $this->body($response),
        );
    }

    /**
     * An evening is one span however many entries it has, over midnight and over pauses; a pause
     * of 6 hours without an entry ends it.
     */
    public function testAnEveningIsOneSpanUntilAPauseOfSixHours(): void
    {
        $this->insert('2026-11-13 20:00:00.000', '2026-11-13 20:20:00.000', '2026-11-13 20:44:59.999', '2026-11-13 21:05:00.000');
        $this->insert('2026-11-13 23:50:00.000', '2026-11-14 00:05:00.000'); // 2.5 hours later, over midnight
        $this->insert('2026-11-14 06:14:59.999');                            // 5 hours 45 minutes later
        $this->insert('2026-11-14 12:15:00.000');                            // 6 hours later

        self::assertSame(
            ['spans' => [self::span('2026-11-13T20:00', '2026-11-14T06:15'), self::span('2026-11-14T12:15', '2026-11-14T12:30')]],
            $this->body($this->days()),
        );
    }

    public function testWithoutAnEntryThatCountsThereIsNoSpan(): void
    {
        $this->record(1, 1);

        self::assertSame(['spans' => []], $this->body($this->days()));
        self::assertSame(['spans' => []], $this->body($this->days(self::NOVEMBER)));
    }

    /**
     * A window lists the spans of its own entries only: a span that runs over its start or
     * end is cut there, as the entries outside are not read.
     */
    public function testAWindowListsTheSpansOfItsEntriesOnly(): void
    {
        $this->insert(
            '2026-10-31 22:50:00.000', // Berlin 23:50 on 31 October, before the window
            '2026-10-31 23:05:00.000', // 00:05 on 1 November
            '2026-11-30 22:55:00.000', // 23:55 on 30 November
            '2026-11-30 23:00:00.000', // midnight, the window's end
        );

        self::assertSame(
            ['spans' => [self::span('2026-10-31T23:00', '2026-10-31T23:15'), self::span('2026-11-30T22:45', '2026-11-30T23:00')]],
            $this->body($this->days(self::NOVEMBER)),
        );
        self::assertSame(
            ['spans' => [self::span('2026-10-31T22:45', '2026-10-31T23:15'), self::span('2026-11-30T22:45', '2026-11-30T23:15')]],
            $this->body($this->days()),
        );
    }

    /**
     * What counts in a ranking window has its quarter hour, and what counts nowhere has none:
     * pending entries, and the entries of a deleted person or drink.
     */
    public function testCountsExactlyWhatTheRankingCounts(): void
    {
        $this->add(1, 1);                // 20:00, counts
        $this->clock->advance('PT15M');
        $this->record(1, 2);             // 20:15, pending
        $this->clock->advance('PT15M');
        $this->add(2, 1);                // 20:30, of a person deleted below
        $this->clock->advance('PT15M');
        $this->add(3, 2);                // 20:45, of a drink deleted below
        $this->clock->advance('PT15M');
        $this->add(3, 1);                // 21:00, counts

        $this->send('DELETE', '/api/persons/2', session: $this->session);
        $this->send('DELETE', '/api/drinks/2', session: $this->session);
        $ranked = $this->body($this->send('GET', '/api/scoreboard?scope=all', session: $this->session));

        // 21:00 is less than 6 hours after 20:00: one session, without the quarter hours that count nowhere.
        $spans = ['spans' => [self::span('2026-11-14T20:00', '2026-11-14T21:15')]];
        self::assertSame($spans, $this->body($this->days()));
        self::assertSame($spans, $this->body($this->days(self::NOVEMBER)));
        self::assertSame(['spans' => [self::span('2026-11-14T20:00', '2026-11-14T20:15')]], $this->body($this->days(
            'from=2026-11-14T20:00:00Z&to=2026-11-14T21:00:00Z',
        )));
        self::assertSame([['Ben', 1], ['Daniel', 1]], array_map(
            static fn(array $row): array => [$row['name'], $row['count']],
            self::listOf($ranked['rows']),
        ));
    }

    public function testAnEntryRecordedBeforeMidnightAndVerifiedTheNextDayKeepsTheQuarterHourItWasRecordedIn(): void
    {
        $this->createAccount('anna', 'annas-startpasswort');
        $anna = $this->signIn('anna', 'annas-startpasswort');
        $this->clock->advance('PT3H59M30S'); // 23:59:30 UTC, half a minute before midnight
        $late = $this->record(1, 1);
        $this->clock->advance('PT1M');       // the next day
        $verification = $this->send('PUT', "/api/entries/{$late}/verification", [], $anna);

        self::assertSame(204, $verification->getStatusCode(), (string) $verification->getBody());
        self::assertSame(['spans' => [self::span('2026-11-14T23:45', '2026-11-15T00:00')]], $this->body($this->days()));
    }

    /** The size grows with the evenings that have entries, never with the entries. */
    public function testManyEntriesInConsecutiveQuarterHoursAreOneSpan(): void
    {
        $values = [];
        for ($i = 1; $i <= 3000; ++$i) {
            // 1 000 entries in each of three quarter hours, spread over each one 900 ms apart.
            $millisecond = intdiv($i - 1, 1000) * 900_000 + ($i - 1) % 1000 * 900;
            $at = (new DateTimeImmutable(self::START))->modify(sprintf('+%d milliseconds', $millisecond));
            $values[] = sprintf("('00000000-0000-4000-9000-%012d', %d, 1, 1, NULL, '%s', 0)", $i, $i % 3 + 1, Timestamp::of($at));
        }
        $this->otherSession()->exec('INSERT INTO entries (id, person_id, drink_id, quantity, account_id, created_at, pending) VALUES ' . implode(', ', $values));

        self::assertEquals(3000, $this->rows('SELECT COUNT(*) AS n FROM entries')[0]['n']);
        self::assertSame(['spans' => [self::span('2026-11-14T20:00', '2026-11-14T20:45')]], $this->body($this->days()));
    }

    /**
     * @return iterable<string, array{string}>
     */
    public static function sessionTimeZones(): iterable
    {
        yield 'an hour ahead, as the local server' => ['+01:00'];
        yield 'behind UTC by a half hour' => ['-09:30'];
    }

    /** The quarter hours are UTC's, whatever the database session's time zone is. */
    #[DataProvider('sessionTimeZones')]
    public function testTheQuarterHoursDoNotDependOnTheSessionsTimeZone(string $timeZone): void
    {
        $session = $this->otherSession();
        $this->insert('2026-11-15 00:00:00.000', '2026-11-14 23:59:59.999', '2026-11-15 07:00:00.000');
        $session->exec("SET time_zone = '{$timeZone}'");
        $scoreboard = new Scoreboard($session, new DataRevision($session));

        $all = $scoreboard->days(Interval::allTime());
        $window = $scoreboard->days(Interval::window(new DateTimeImmutable('2026-11-15T00:00:00Z'), new DateTimeImmutable('2026-11-15T01:00:00Z')));

        self::assertSame(
            [['2026-11-14T23:45:00.000Z', '2026-11-15T00:15:00.000Z'], ['2026-11-15T07:00:00.000Z', '2026-11-15T07:15:00.000Z']],
            array_map(static fn(Span $span): array => [Instant::format($span->from), Instant::format($span->to)], $all),
        );
        self::assertSame(
            [['2026-11-15T00:00:00.000Z', '2026-11-15T00:15:00.000Z']],
            array_map(static fn(Span $span): array => [Instant::format($span->from), Instant::format($span->to)], $window),
        );
    }

    public function testTheDaysNeedASession(): void
    {
        self::assertSame(401, $this->send('GET', '/api/scoreboard/days?scope=all')->getStatusCode());
    }

    public function testTheETagNamesTheRevisionAndTheSelectionAndAnUnchangedOneAnswers304(): void
    {
        $this->add(1, 1);
        $all = $this->days()->getHeaderLine('ETag');
        $november = $this->days(self::NOVEMBER)->getHeaderLine('ETag');

        $conditional = $this->days('scope=all', $all);
        $otherSelection = $this->days(self::NOVEMBER, $all);

        self::assertSame(sprintf('"%d-all"', $this->revision()), $all);
        self::assertSame(sprintf('"%d-1793487600000-1796079600000"', $this->revision()), $november);
        self::assertSame([304, '', $all], [$conditional->getStatusCode(), (string) $conditional->getBody(), $conditional->getHeaderLine('ETag')]);
        self::assertSame([200, $november], [$otherSelection->getStatusCode(), $otherSelection->getHeaderLine('ETag')]);
    }

    public function testAVerificationAndADeleteChangeTheTag(): void
    {
        $this->createAccount('anna', 'annas-startpasswort');
        $anna = $this->signIn('anna', 'annas-startpasswort');
        $id = $this->record(1, 1);
        $pending = $this->days(self::NOVEMBER);

        $this->send('PUT', "/api/entries/{$id}/verification", [], $anna);
        $verified = $this->days(self::NOVEMBER, $pending->getHeaderLine('ETag'));
        $this->send('DELETE', "/api/entries/{$id}", session: $this->session);
        $deleted = $this->days(self::NOVEMBER, $verified->getHeaderLine('ETag'));

        self::assertSame(['spans' => []], $this->body($pending));
        self::assertSame(['spans' => [self::span('2026-11-14T20:00', '2026-11-14T20:15')]], $this->body($verified));
        self::assertSame(['spans' => []], $this->body($deleted));
    }

    /**
     * @param string $from minutes in UTC, `2026-11-14T20:00`
     * @param string $to   minutes in UTC
     *
     * @return array{from: string, to: string}
     */
    private static function span(string $from, string $to): array
    {
        return ['from' => "{$from}:00.000Z", 'to' => "{$to}:00.000Z"];
    }

    /** Verified entries recorded at the given UTC `DATETIME(3)`s, by Daniel. */
    private function insert(string ...$recordedAt): void
    {
        $values = [];
        foreach ($recordedAt as $at) {
            ++$this->entries;
            $values[] = sprintf("('00000000-0000-4000-9000-%012d', 1, 1, 1, NULL, '%s', 0)", $this->entries, $at);
        }
        $this->otherSession()->exec('INSERT INTO entries (id, person_id, drink_id, quantity, account_id, created_at, pending) VALUES ' . implode(', ', $values));
    }

    private function days(string $selection = 'scope=all', ?string $ifNoneMatch = null): ResponseInterface
    {
        return $this->send('GET', "/api/scoreboard/days?{$selection}", session: $this->session, headers: $ifNoneMatch === null ? [] : ['If-None-Match' => $ifNoneMatch]);
    }

    private function revision(): int
    {
        $revision = $this->rows('SELECT revision FROM data_revision')[0]['revision'];
        self::assertIsNumeric($revision);

        return (int) $revision;
    }

    /**
     * @return list<array<string, mixed>>
     */
    private static function listOf(mixed $list): array
    {
        self::assertIsList($list);

        /** @var list<array<string, mixed>> */
        return $list;
    }

    /** Records an entry and lets it count. */
    private function add(int $personId, int $drinkId): string
    {
        $id = $this->record($personId, $drinkId);
        $this->verifyDirectly('entries', $id);

        return $id;
    }

    /** Records an entry, which waits for verification. */
    private function record(int $personId, int $drinkId): string
    {
        ++$this->entries;
        $id = sprintf('00000000-0000-4000-8000-%012d', $this->entries);
        $response = $this->send('PUT', "/api/entries/{$id}", ['personId' => $personId, 'drinkId' => $drinkId, 'quantity' => 1], $this->session);
        self::assertSame(201, $response->getStatusCode(), (string) $response->getBody());

        return $id;
    }
}
