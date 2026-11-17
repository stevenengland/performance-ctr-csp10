<?php

declare(strict_types=1);

namespace Performance\Tests\Integration;

use DateTimeImmutable;
use Performance\Domain\DataRevision;
use Performance\Domain\Scoreboard;
use Performance\Domain\Timestamp;
use Performance\Http\Instant;
use Performance\Tests\Support\DatabaseTestCase;
use PHPUnit\Framework\Attributes\DataProvider;
use Psr\Http\Message\ResponseInterface;

/** The quarter hours with drinks that count, at `GET /api/scoreboard/days`, with their ETag. */
final class ScoreboardDaysTest extends DatabaseTestCase
{
    private const START = '2026-11-14T20:00:00Z';

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

    public function testListsTheStartOfEachQuarterHourWithAVerifiedEntryAscendingAndLeavesPendingEntriesOut(): void
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
            ['instants' => ['2026-11-14T20:00:00.000Z', '2026-11-15T20:00:00.000Z', '2026-11-15T20:15:00.000Z']],
            $this->body($response),
        );
    }

    public function testWithoutAnEntryThatCountsThereIsNoInstant(): void
    {
        $this->record(1, 1);

        self::assertSame(['instants' => []], $this->body($this->days()));
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

        self::assertSame(['instants' => ['2026-11-14T20:00:00.000Z', '2026-11-14T21:00:00.000Z']], $this->body($this->days()));
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
        self::assertSame(['instants' => ['2026-11-14T23:45:00.000Z']], $this->body($this->days()));
    }

    /** The size grows with the quarter hours that have entries, never with the entries. */
    public function testManyEntriesInOneQuarterHourAreOneInstant(): void
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
        self::assertSame(
            ['instants' => ['2026-11-14T20:00:00.000Z', '2026-11-14T20:15:00.000Z', '2026-11-14T20:30:00.000Z']],
            $this->body($this->days()),
        );
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
        $session->exec(
            "INSERT INTO entries (id, person_id, drink_id, quantity, account_id, created_at, pending) VALUES
             ('00000000-0000-4000-9000-000000000001', 1, 1, 1, NULL, '2026-11-15 00:00:00.000', 0),
             ('00000000-0000-4000-9000-000000000002', 2, 1, 1, NULL, '2026-11-14 23:59:59.999', 0)",
        );
        $session->exec("SET time_zone = '{$timeZone}'");

        $instants = (new Scoreboard($session, new DataRevision($session)))->days();

        self::assertSame(['2026-11-14T23:45:00.000Z', '2026-11-15T00:00:00.000Z'], array_map(Instant::format(...), $instants));
    }

    public function testTheDaysNeedASession(): void
    {
        self::assertSame(401, $this->send('GET', '/api/scoreboard/days')->getStatusCode());
    }

    public function testTheETagIsTheDataRevisionAndAnUnchangedOneAnswers304(): void
    {
        $this->add(1, 1);
        $first = $this->days();
        $tag = $first->getHeaderLine('ETag');

        $conditional = $this->days($tag);

        self::assertSame(sprintf('"%d"', $this->revision()), $tag);
        self::assertSame(304, $conditional->getStatusCode());
        self::assertSame('', (string) $conditional->getBody());
        self::assertSame($tag, $conditional->getHeaderLine('ETag'));
    }

    public function testAVerificationAndADeleteChangeTheTag(): void
    {
        $this->createAccount('anna', 'annas-startpasswort');
        $anna = $this->signIn('anna', 'annas-startpasswort');
        $id = $this->record(1, 1);
        $pending = $this->days();

        $this->send('PUT', "/api/entries/{$id}/verification", [], $anna);
        $verified = $this->days($pending->getHeaderLine('ETag'));
        $this->send('DELETE', "/api/entries/{$id}", session: $this->session);
        $deleted = $this->days($verified->getHeaderLine('ETag'));

        self::assertSame(['instants' => []], $this->body($pending));
        self::assertSame(['instants' => ['2026-11-14T20:00:00.000Z']], $this->body($verified));
        self::assertSame(['instants' => []], $this->body($deleted));
    }

    private function days(?string $ifNoneMatch = null): ResponseInterface
    {
        return $this->send('GET', '/api/scoreboard/days', session: $this->session, headers: $ifNoneMatch === null ? [] : ['If-None-Match' => $ifNoneMatch]);
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
