<?php

declare(strict_types=1);

namespace Performance\Tests\Integration;

use DateTimeImmutable;
use Performance\Domain\Timestamp;
use Performance\Tests\Support\DatabaseTestCase;
use Psr\Http\Message\ResponseInterface;

/** The quarter hours a game was played in, at `GET /api/games/{id}/standings/days`, with their ETag. */
final class StandingsDaysTest extends DatabaseTestCase
{
    private const SCHACH = 1;
    private const ROMME = 2;

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

    public function testADuelGameListsTheQuarterHoursOfItsVerifiedMatchesInEveryRunAndOneForBothPlayers(): void
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
        self::assertSame(['instants' => ['2026-11-14T20:00:00.000Z', '2026-11-15T20:00:00.000Z']], $this->body($response));
    }

    public function testAPointsGameListsTheQuarterHoursOfItsVerifiedResultsInEveryRun(): void
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
        self::assertSame(['instants' => ['2026-11-14T20:00:00.000Z', '2026-11-14T20:45:00.000Z']], $this->body($response));
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

        self::assertSame(['instants' => ['2026-11-14T20:00:00.000Z']], $this->body($this->days(self::SCHACH)));
        self::assertSame(['instants' => ['2026-11-14T20:15:00.000Z']], $this->body($this->days(self::ROMME)));
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

        self::assertSame(['instants' => ['2026-11-14T23:45:00.000Z']], $this->body($this->days(self::SCHACH)));
        self::assertSame(['instants' => ['2026-11-14T23:45:00.000Z']], $this->body($this->days(self::ROMME)));
    }

    /** The size grows with the quarter hours that have rows, never with the rows. */
    public function testManyRowsInOneQuarterHourAreOneInstant(): void
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

        $quarters = ['instants' => ['2026-11-14T20:00:00.000Z', '2026-11-14T20:15:00.000Z']];
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
        self::assertSame(401, $this->send('GET', '/api/games/1/standings/days')->getStatusCode());
    }

    public function testTheETagIsTheDataRevisionAndAnUnchangedOneAnswers304(): void
    {
        $this->verify('matches', $this->match(1, 2, 'first'));
        $first = $this->days(self::SCHACH);
        $tag = $first->getHeaderLine('ETag');

        $conditional = $this->days(self::SCHACH, $tag);

        self::assertSame(sprintf('"%d"', $this->revision()), $tag);
        self::assertSame(304, $conditional->getStatusCode());
        self::assertSame('', (string) $conditional->getBody());
        self::assertSame($tag, $conditional->getHeaderLine('ETag'));
    }

    public function testAVerificationAndADeleteChangeTheTag(): void
    {
        $id = $this->score(1, 10);
        $pending = $this->days(self::ROMME);

        $this->verify('results', $id);
        $verified = $this->days(self::ROMME, $pending->getHeaderLine('ETag'));
        $this->send('DELETE', "/api/results/{$id}", session: $this->session);
        $deleted = $this->days(self::ROMME, $verified->getHeaderLine('ETag'));

        self::assertSame(['instants' => []], $this->body($pending));
        self::assertSame(['instants' => ['2026-11-14T20:00:00.000Z']], $this->body($verified));
        self::assertSame(['instants' => []], $this->body($deleted));
    }

    private function days(int $game, ?string $ifNoneMatch = null): ResponseInterface
    {
        return $this->send('GET', "/api/games/{$game}/standings/days", session: $this->session, headers: $ifNoneMatch === null ? [] : ['If-None-Match' => $ifNoneMatch]);
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
