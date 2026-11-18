<?php

declare(strict_types=1);

namespace Performance\Tests\Integration;

use DateTimeImmutable;
use Performance\Domain\Timestamp;
use Performance\Tests\Support\DatabaseTestCase;
use Psr\Http\Message\ResponseInterface;

/**
 * The days a game was played, at `GET /api/games/{id}/standings/days`: the runs of consecutive
 * quarter hours with a verified match or result of any run, for a bounded window or all time,
 * with their ETag.
 */
final class StandingsDaysTest extends DatabaseTestCase
{
    private const SCHACH = 1;
    private const ROMME = 2;
    /** November 2026 in Berlin: 2026-10-31T23:00Z to 2026-11-30T23:00Z. */
    private const NOVEMBER = 'from=2026-11-01T00:00:00%2B01:00&to=2026-12-01T00:00:00%2B01:00';

    private string $session;
    /** Another account's session, which verifies what the bootstrap admin records. */
    private string $verifier;
    private int $writes = 0;

    protected function setUp(): void
    {
        parent::setUp();
        $this->session = $this->signIn();
        foreach (['Anna', 'Ben', 'Carla', 'Daniel'] as $name) {
            $this->send('POST', '/api/persons', ['name' => $name], $this->session);
        }
        $this->send('POST', '/api/games', ['name' => 'Schach', 'kind' => 'duel'], $this->session);
        $this->send('POST', '/api/games', ['name' => 'Rommé', 'kind' => 'points', 'lowerWins' => true], $this->session);
        $this->createAccount('pruefer', 'pruefers-passwort');
        $this->verifier = $this->signIn('pruefer', 'pruefers-passwort');
    }

    public function testADuelGameListsTheSessionsOfItsVerifiedMatchesInEveryRunOnceForBothPlayers(): void
    {
        $this->verify('matches', $this->match(1, 2, 'first'));  // 2026-11-14 20:00 UTC, run 1
        $this->clock->advance('PT10M');
        $this->verify('matches', $this->match(3, 4, 'draw'));   // 20:10, the same quarter hour
        $this->send('POST', '/api/games/1/restart', session: $this->session);
        $this->clock->advance('P1D');
        $this->verify('matches', $this->match(2, 3, 'second')); // 2026-11-15 20:10, run 2
        $this->clock->advance('PT30M');
        $this->match(1, 4, 'first');                            // 20:40, pending
        $this->verify('results', $this->score(1, 10));         // 20:40, another game

        $response = $this->days(self::SCHACH);

        self::assertSame(200, $response->getStatusCode(), (string) $response->getBody());
        self::assertSame(['spans' => [self::span('2026-11-14T20:00', '2026-11-14T20:15'), self::span('2026-11-15T20:00', '2026-11-15T20:15')]], $this->body($response));
    }

    public function testAPointsGameListsTheSessionsOfItsVerifiedResultsInEveryRun(): void
    {
        $this->verify('results', $this->score(1, 10));  // 2026-11-14 20:00 UTC, run 1
        $this->verify('results', $this->score(2, 7));
        $this->send('POST', '/api/games/2/restart', session: $this->session);
        $this->clock->advance('PT45M');
        $this->verify('results', $this->score(3, 4));   // 20:45, run 2
        $this->clock->advance('PT15M');
        $this->score(4, 2);                             // 21:00, pending
        $this->verify('matches', $this->match(1, 2, 'first')); // 21:00, another game

        $response = $this->days(self::ROMME);

        self::assertSame(200, $response->getStatusCode(), (string) $response->getBody());
        self::assertSame(['spans' => [self::span('2026-11-14T20:00', '2026-11-14T21:00')]], $this->body($response));
    }

    /**
     * A match counts while one of its sides still names a person, as in the ranking; once both
     * persons are deleted it counts for no one, and a deleted person's results go with them.
     */
    public function testCountsExactlyWhatTheRankingCounts(): void
    {
        $this->verify('matches', $this->match(1, 2, 'first')); // 20:00, Ben deleted below: still Anna's win
        $this->clock->advance('PT15M');
        $this->verify('matches', $this->match(3, 4, 'first')); // 20:15, both deleted below
        $this->verify('results', $this->score(1, 10));        // 20:15
        $this->clock->advance('PT15M');
        $this->verify('results', $this->score(3, 4));         // 20:30, Carla deleted below

        foreach ([2, 3, 4] as $person) {
            $this->send('DELETE', "/api/persons/{$person}", session: $this->session);
        }
        $duel = $this->body($this->send('GET', '/api/games/1/standings', session: $this->session));
        $points = $this->body($this->send('GET', '/api/games/2/standings', session: $this->session));

        foreach (['scope=all', self::NOVEMBER] as $selection) {
            self::assertSame(['spans' => [self::span('2026-11-14T20:00', '2026-11-14T20:15')]], $this->body($this->days(self::SCHACH, $selection)));
            self::assertSame(['spans' => [self::span('2026-11-14T20:15', '2026-11-14T20:30')]], $this->body($this->days(self::ROMME, $selection)));
        }
        self::assertSame(['Anna'], array_column(self::listOf($duel['rows']), 'name'));
        self::assertSame([['Anna', 10]], array_map(static fn(array $row): array => [$row['name'], $row['sum']], self::listOf($points['rows'])));
    }

    public function testARowRecordedBeforeMidnightAndVerifiedTheNextDayKeepsTheQuarterHourItWasRecordedIn(): void
    {
        $this->clock->advance('PT3H59M30S'); // 23:59:30 UTC, half a minute before midnight
        $match = $this->match(1, 2, 'draw');
        $result = $this->score(1, 3);
        $this->clock->advance('PT1M');       // the next day
        $this->verify('matches', $match);
        $this->verify('results', $result);

        $quarter = ['spans' => [self::span('2026-11-14T23:45', '2026-11-15T00:00')]];
        self::assertSame($quarter, $this->body($this->days(self::SCHACH)));
        self::assertSame($quarter, $this->body($this->days(self::ROMME)));
    }

    /** The size grows with the sessions that have rows, never with the rows or their quarter hours. */
    public function testManyRowsInConsecutiveQuarterHoursAreOneSpan(): void
    {
        $matches = [];
        $results = [];
        for ($i = 1; $i <= 1500; ++$i) {
            // 750 rows in each of two quarter hours, 1.2 s apart, of both runs.
            $at = Timestamp::of((new DateTimeImmutable('2026-11-14T20:00:00Z'))->modify(sprintf('+%d milliseconds', intdiv($i - 1, 750) * 900_000 + ($i - 1) % 750 * 1200)));
            $run = $i % 2 + 1;
            $matches[] = sprintf("('00000000-0000-4000-9000-%012d', 1, 1, 2, 'first', %d, NULL, '%s', 0)", $i, $run, $at);
            $results[] = sprintf("('00000000-0000-4000-a000-%012d', 2, %d, 5, %d, NULL, '%s', 0)", $i, $i % 4 + 1, $run, $at);
        }
        $session = $this->otherSession();
        $session->exec('INSERT INTO matches (id, game_id, first_person_id, second_person_id, outcome, run, account_id, created_at, pending) VALUES ' . implode(', ', $matches));
        $session->exec('INSERT INTO results (id, game_id, person_id, points, run, account_id, created_at, pending) VALUES ' . implode(', ', $results));

        $quarters = ['spans' => [self::span('2026-11-14T20:00', '2026-11-14T20:30')]];
        self::assertSame($quarters, $this->body($this->days(self::SCHACH)));
        self::assertSame($quarters, $this->body($this->days(self::ROMME)));
    }

    public function testAnUnknownGameIs404AndTheRouteNeedsASession(): void
    {
        $this->send('DELETE', '/api/games/2', session: $this->session);

        $unknown = $this->days(9);
        $deleted = $this->days(self::ROMME);

        self::assertSame(404, $unknown->getStatusCode());
        self::assertSame('urn:performance:problem:not-found', $this->body($unknown)['type']);
        self::assertSame(404, $deleted->getStatusCode());
        self::assertSame(401, $this->send('GET', '/api/games/1/standings/days?scope=all')->getStatusCode());
    }

    public function testTheETagNamesTheRevisionAndTheSelectionAndAnUnchangedOneAnswers304(): void
    {
        $this->verify('matches', $this->match(1, 2, 'first'));
        $all = $this->days(self::SCHACH)->getHeaderLine('ETag');
        $november = $this->days(self::SCHACH, self::NOVEMBER)->getHeaderLine('ETag');

        $conditional = $this->days(self::SCHACH, 'scope=all', $all);
        $otherSelection = $this->days(self::SCHACH, self::NOVEMBER, $all);

        self::assertSame(sprintf('"%d-all"', $this->revision()), $all);
        self::assertSame(sprintf('"%d-1793487600000-1796079600000"', $this->revision()), $november);
        self::assertSame([304, '', $all], [$conditional->getStatusCode(), (string) $conditional->getBody(), $conditional->getHeaderLine('ETag')]);
        self::assertSame([200, $november], [$otherSelection->getStatusCode(), $otherSelection->getHeaderLine('ETag')]);
    }

    /** A window lists the spans of its own matches and results only, of any run. */
    public function testAWindowListsTheSpansOfItsRowsOnly(): void
    {
        $session = $this->otherSession();
        $session->exec(
            "INSERT INTO matches (id, game_id, first_person_id, second_person_id, outcome, run, account_id, created_at, pending) VALUES
             ('00000000-0000-4000-9000-000000000001', 1, 1, 2, 'first', 1, NULL, '2026-10-31 22:50:00.000', 0),
             ('00000000-0000-4000-9000-000000000002', 1, 1, 2, 'first', 2, NULL, '2026-10-31 23:05:00.000', 0),
             ('00000000-0000-4000-9000-000000000003', 1, 1, 2, 'first', 2, NULL, '2026-11-30 23:00:00.000', 0)",
        );
        $session->exec(
            "INSERT INTO results (id, game_id, person_id, points, run, account_id, created_at, pending) VALUES
             ('00000000-0000-4000-a000-000000000001', 2, 1, 5, 1, NULL, '2026-11-30 22:59:59.999', 0),
             ('00000000-0000-4000-a000-000000000002', 2, 1, 5, 2, NULL, '2026-11-30 23:00:00.000', 0)",
        );

        self::assertSame(['spans' => [self::span('2026-10-31T23:00', '2026-10-31T23:15')]], $this->body($this->days(self::SCHACH, self::NOVEMBER)));
        self::assertSame(['spans' => [self::span('2026-11-30T22:45', '2026-11-30T23:00')]], $this->body($this->days(self::ROMME, self::NOVEMBER)));
        self::assertSame(
            ['spans' => [self::span('2026-10-31T22:45', '2026-10-31T23:15'), self::span('2026-11-30T23:00', '2026-11-30T23:15')]],
            $this->body($this->days(self::SCHACH)),
        );
    }

    public function testAVerificationAndADeleteChangeTheTag(): void
    {
        $id = $this->score(1, 10);
        $pending = $this->days(self::ROMME, self::NOVEMBER);

        $this->verify('results', $id);
        $verified = $this->days(self::ROMME, self::NOVEMBER, $pending->getHeaderLine('ETag'));
        $this->send('DELETE', "/api/results/{$id}", session: $this->session);
        $deleted = $this->days(self::ROMME, self::NOVEMBER, $verified->getHeaderLine('ETag'));

        self::assertSame(['spans' => []], $this->body($pending));
        self::assertSame(['spans' => [self::span('2026-11-14T20:00', '2026-11-14T20:15')]], $this->body($verified));
        self::assertSame(['spans' => []], $this->body($deleted));
    }

    private function days(int $game, string $selection = 'scope=all', ?string $ifNoneMatch = null): ResponseInterface
    {
        return $this->send('GET', "/api/games/{$game}/standings/days?{$selection}", session: $this->session, headers: $ifNoneMatch === null ? [] : ['If-None-Match' => $ifNoneMatch]);
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

    private function revision(): int
    {
        $revision = $this->rows('SELECT revision FROM data_revision')[0]['revision'];
        self::assertIsNumeric($revision);

        return (int) $revision;
    }

    /**
     * @return list<array<string, mixed>>
     */
    private static function listOf(mixed $rows): array
    {
        self::assertIsList($rows);

        /** @var list<array<string, mixed>> */
        return $rows;
    }

    /** Records a match in Schach, which waits for verification. */
    private function match(int $first, int $second, string $outcome): string
    {
        return $this->write('matches', ['gameId' => self::SCHACH, 'firstPersonId' => $first, 'secondPersonId' => $second, 'outcome' => $outcome]);
    }

    /** Records a result in Rommé, which waits for verification. */
    private function score(int $person, int $points): string
    {
        return $this->write('results', ['gameId' => self::ROMME, 'personId' => $person, 'points' => $points]);
    }

    /**
     * @param 'matches'|'results'  $table
     * @param array<string, mixed> $json
     */
    private function write(string $table, array $json): string
    {
        ++$this->writes;
        $id = sprintf('00000000-0000-4000-8000-%012d', $this->writes);
        $response = $this->send('PUT', "/api/{$table}/{$id}", $json, $this->session);
        self::assertSame(201, $response->getStatusCode(), (string) $response->getBody());

        return $id;
    }

    /**
     * Another account verifies a match or result, so it counts.
     *
     * @param 'matches'|'results' $table
     */
    private function verify(string $table, string $id): void
    {
        $verified = $this->send('PUT', "/api/{$table}/{$id}/verification", [], $this->verifier);
        self::assertSame(204, $verified->getStatusCode(), (string) $verified->getBody());
    }
}
