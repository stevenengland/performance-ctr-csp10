<?php

declare(strict_types=1);

namespace Performance\Tests\Integration;

use DateTimeImmutable;
use Performance\Domain\Actor;
use Performance\Domain\AuditLog;
use Performance\Domain\DataRevision;
use Performance\Domain\Games\CurrentRun;
use Performance\Domain\Games\DuelRow;
use Performance\Domain\Games\Game;
use Performance\Domain\Games\GameKind;
use Performance\Domain\Games\Matches;
use Performance\Domain\Idempotency;
use Performance\Domain\Snapshot;
use Performance\Tests\Support\DatabaseTestCase;
use PHPUnit\Framework\Attributes\DataProvider;
use Psr\Http\Message\ResponseInterface;

/** A game's ranking at `GET /api/games/{id}/standings`, with its ETag. */
final class StandingsTest extends DatabaseTestCase
{
    private const NOW = '2026-11-14T20:00:00.000Z';

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

    /**
     * Win 1, draw ½, loss 0; ties by more wins, then by name. Carla, Anna and Ben have two
     * points each: Carla won twice, Anna and Ben once, so the name puts Anna before Ben.
     */
    public function testRanksADuelGameByPointsThenWinsThenName(): void
    {
        $this->record(1, 2, 'draw');   // Anna ½, Ben ½
        $this->record(2, 1, 'draw');   // Ben ½, Anna ½
        $this->record(3, 4, 'first');  // Carla 1, Daniel 0
        $this->record(2, 3, 'first');  // Ben 1, Carla 0
        $this->record(4, 3, 'second'); // Carla 1, Daniel 0
        $this->record(4, 2, 'first');  // Daniel 1, Ben 0
        $this->record(3, 1, 'second'); // Anna 1, Carla 0

        $response = $this->standings();

        self::assertSame(200, $response->getStatusCode(), (string) $response->getBody());
        self::assertSame(
            [
                'kind' => 'duel',
                'startedAt' => self::NOW,
                'rows' => [
                    self::row(3, 'Carla', 2, 2, 0, 2),
                    self::row(1, 'Anna', 2, 1, 2, 0),
                    self::row(2, 'Ben', 2, 1, 2, 1),
                    self::row(4, 'Daniel', 1, 1, 0, 2),
                ],
                'unranked' => [],
            ],
            $this->body($response),
        );
    }

    public function testCountsOnlyTheCurrentRunAndOnlyPersonsWhoPlayedInIt(): void
    {
        $this->record(1, 2, 'first');
        $this->clock->advance('PT1H');
        $this->send('POST', '/api/games/1/restart', [], $this->session);
        $this->record(3, 1, 'first');

        $body = $this->body($this->standings());

        self::assertSame('2026-11-14T21:00:00.000Z', $body['startedAt']);
        self::assertSame([self::row(3, 'Carla', 1, 1, 0, 0), self::row(1, 'Anna', 0, 0, 0, 1)], $body['rows']);
    }

    public function testANewGameHasNoRows(): void
    {
        self::assertSame(['kind' => 'duel', 'startedAt' => self::NOW, 'rows' => [], 'unranked' => []], $this->body($this->standings()));
    }

    public function testANewPointsGameAnswersItsKindWithNoRows(): void
    {
        $response = $this->standings(game: 2);

        self::assertSame(200, $response->getStatusCode());
        self::assertSame(['kind' => 'points', 'startedAt' => self::NOW, 'lowerWins' => true, 'rows' => [], 'unranked' => []], $this->body($response));
    }

    /**
     * Rommé ranks the lowest sum first: Ben and Carla tie on 15, so the name puts Ben first;
     * Daniel, without a result, is absent.
     */
    public function testRanksAPointsGameBySumInTheGamesDirectionThenName(): void
    {
        $this->score(1, 40);
        $this->score(3, 20);
        $this->score(2, -5);
        $this->score(1, -10);
        $this->score(2, 20);
        $this->score(3, -5);

        $response = $this->standings(game: 2);

        self::assertSame(200, $response->getStatusCode(), (string) $response->getBody());
        self::assertSame(
            [
                'kind' => 'points',
                'startedAt' => self::NOW,
                'lowerWins' => true,
                'rows' => [
                    ['personId' => 2, 'name' => 'Ben', 'sum' => 15, 'results' => 2, 'pendingCount' => 0],
                    ['personId' => 3, 'name' => 'Carla', 'sum' => 15, 'results' => 2, 'pendingCount' => 0],
                    ['personId' => 1, 'name' => 'Anna', 'sum' => 30, 'results' => 2, 'pendingCount' => 0],
                ],
                'unranked' => [],
            ],
            $this->body($response),
        );
    }

    public function testChangingLowerWinsReRanksAtOnce(): void
    {
        $this->score(1, 40);
        $this->score(2, 15);
        $this->score(3, 15);
        $tag = $this->standings(game: 2)->getHeaderLine('ETag');

        $changed = $this->send('PATCH', '/api/games/2', ['name' => 'Rommé', 'lowerWins' => false], $this->session);

        self::assertSame(200, $changed->getStatusCode(), (string) $changed->getBody());
        $response = $this->standings($tag, 2);
        self::assertSame(200, $response->getStatusCode(), 'a new setting is a new ranking');
        $body = $this->body($response);
        self::assertFalse($body['lowerWins']);
        self::assertSame([['Anna', 40], ['Ben', 15], ['Carla', 15]], array_map(self::nameAndSum(...), self::listOf($body['rows'])));
    }

    public function testAPointsGameCountsOnlyTheCurrentRun(): void
    {
        $this->score(1, 40);
        $this->clock->advance('PT1H');
        $this->send('POST', '/api/games/2/restart', [], $this->session);
        $this->score(2, 7);

        $body = $this->body($this->standings(game: 2));

        self::assertSame('2026-11-14T21:00:00.000Z', $body['startedAt']);
        self::assertSame([['personId' => 2, 'name' => 'Ben', 'sum' => 7, 'results' => 1, 'pendingCount' => 0]], $body['rows']);
    }

    /**
     * @return iterable<string, array{string, string, array<string, mixed>|null}>
     */
    public static function resultWrites(): iterable
    {
        yield 'a recorded result' => ['PUT', '/api/results/00000000-0000-4000-8000-000000000777', ['gameId' => 2, 'personId' => 3, 'points' => 4]];
        yield 'an undone result' => ['DELETE', '/api/results/00000000-0000-4000-8000-000000000001', null];
    }

    /**
     * @param array<string, mixed>|null $json
     */
    #[DataProvider('resultWrites')]
    public function testEveryResultWriteChangesTheTag(string $method, string $path, ?array $json): void
    {
        $this->score(1, 40);
        $tag = $this->standings(game: 2)->getHeaderLine('ETag');

        $write = $this->send($method, $path, $json, $this->session);

        self::assertLessThan(300, $write->getStatusCode(), (string) $write->getBody());
        self::assertSame(200, $this->standings($tag, 2)->getStatusCode());
    }

    public function testAnUnknownGameIs404AndTheRouteNeedsASession(): void
    {
        $unknown = $this->standings(game: 9);

        self::assertSame(404, $unknown->getStatusCode());
        self::assertSame('urn:performance:problem:not-found', $this->body($unknown)['type']);
        self::assertSame(401, $this->send('GET', '/api/games/1/standings')->getStatusCode());
    }

    public function testAnUnchangedRevisionAnswers304(): void
    {
        $this->record(1, 2, 'first');
        $first = $this->standings();
        $tag = $first->getHeaderLine('ETag');

        $conditional = $this->standings($tag);

        self::assertMatchesRegularExpression('/^"[^"]+"$/', $tag);
        self::assertSame(304, $conditional->getStatusCode());
        self::assertSame('', (string) $conditional->getBody());
        self::assertSame($tag, $conditional->getHeaderLine('ETag'));
        self::assertSame(304, $this->standings(substr($tag, 0, -1) . '-gzip"')->getStatusCode(), 'as Apache compresses it ("42-gzip"), like the scoreboard');
    }

    /**
     * @return iterable<string, array{string, string, array<string, mixed>|null}>
     */
    public static function matchWrites(): iterable
    {
        yield 'a recorded match' => ['PUT', '/api/matches/00000000-0000-4000-8000-000000000777', ['gameId' => 1, 'firstPersonId' => 3, 'secondPersonId' => 4, 'outcome' => 'draw']];
        yield 'an undone match' => ['DELETE', '/api/matches/00000000-0000-4000-8000-000000000001', null];
        yield 'a restart' => ['POST', '/api/games/1/restart', []];
    }

    /**
     * @param array<string, mixed>|null $json
     */
    #[DataProvider('matchWrites')]
    public function testEveryMatchWriteChangesTheTag(string $method, string $path, ?array $json): void
    {
        $this->record(1, 2, 'first');
        $tag = $this->standings()->getHeaderLine('ETag');

        $write = $this->send($method, $path, $json, $this->session);

        self::assertLessThan(300, $write->getStatusCode(), (string) $write->getBody());
        self::assertSame(200, $this->standings($tag)->getStatusCode());
    }

    public function testAReplayedOrRefusedMatchLeavesTheTag(): void
    {
        $this->record(1, 2, 'first');
        $tag = $this->standings()->getHeaderLine('ETag');

        $this->send('PUT', '/api/matches/00000000-0000-4000-8000-000000000001', ['gameId' => 1, 'firstPersonId' => 1, 'secondPersonId' => 2, 'outcome' => 'first'], $this->session);
        $this->send('PUT', '/api/matches/00000000-0000-4000-8000-000000000002', ['gameId' => 1, 'firstPersonId' => 1, 'secondPersonId' => 1, 'outcome' => 'first'], $this->session);

        self::assertSame(304, $this->standings($tag)->getStatusCode());
    }

    /**
     * The revision and the ranking come from one snapshot: a write another request commits
     * between the two reads is in neither, so the tag read first never names a ranking that
     * already contains the write (no stale 304 later).
     */
    public function testTheRevisionAndTheRankingReadOneSnapshot(): void
    {
        $this->record(1, 2, 'first');
        $reader = $this->otherSession();
        $revision = new DataRevision($reader);
        $matches = new Matches($reader, $this->clock, $revision, new AuditLog($reader, $this->clock), new Idempotency($reader, $revision));
        $writer = $this->otherSession();
        $schach = new Game(1, 'Schach', GameKind::Duel, true, false, 1, new DateTimeImmutable(self::NOW));

        [$read, $rows] = (new Snapshot($reader))->read(static function () use ($revision, $matches, $schach, $writer): array {
            $read = $revision->current();
            // Another request commits a match between the reads of this one.
            $writer->exec(
                "INSERT INTO matches (id, game_id, first_person_id, second_person_id, outcome, run, account_id, created_at)
                 VALUES ('00000000-0000-4000-8000-000000000999', 1, 3, 4, 'first', 1, 1, '2026-11-14 20:00:00.000')",
            );
            $writer->exec('UPDATE data_revision SET revision = revision + 1');

            return [$read, $matches->standings($schach, new CurrentRun())->rows];
        });

        self::assertSame(['Anna', 'Ben'], array_map(static fn(DuelRow $row): string => $row->name, $rows), 'the ranking belongs to the revision that was read');
        self::assertCount(4, $matches->standings($schach, new CurrentRun())->rows, 'a read after the snapshot sees the write');
        self::assertSame($read + 1, $revision->current());
    }

    /**
     * @return array{personId: int, name: string, points: int|float, wins: int, draws: int, losses: int, played: int, pendingCount: int}
     */
    private static function row(int $personId, string $name, int|float $points, int $wins, int $draws, int $losses): array
    {
        return [
            'personId' => $personId,
            'name' => $name,
            'points' => $points,
            'wins' => $wins,
            'draws' => $draws,
            'losses' => $losses,
            'played' => $wins + $draws + $losses,
            'pendingCount' => 0,
        ];
    }

    /**
     * @param array<string, mixed> $row
     *
     * @return array{mixed, mixed}
     */
    private static function nameAndSum(array $row): array
    {
        return [$row['name'], $row['sum']];
    }

    /**
     * @return list<array<string, mixed>>
     */
    private static function listOf(mixed $rows): array
    {
        self::assertIsArray($rows);

        /** @var list<array<string, mixed>> */
        return $rows;
    }

    /** Records a result in Rommé, numbered with the matches, and another account verifies it, so it counts. */
    private function score(int $person, int $points): void
    {
        ++$this->writes;
        $id = sprintf('00000000-0000-4000-8000-%012d', $this->writes);
        $response = $this->send('PUT', "/api/results/{$id}", ['gameId' => 2, 'personId' => $person, 'points' => $points], $this->session);
        self::assertSame(201, $response->getStatusCode(), (string) $response->getBody());
        $verified = $this->send('PUT', "/api/results/{$id}/verification", [], $this->verifier);
        self::assertSame(204, $verified->getStatusCode(), (string) $verified->getBody());
    }

    /** Records a match in Schach, and another account verifies it, so it counts. */
    private function record(int $first, int $second, string $outcome): void
    {
        ++$this->writes;
        $id = sprintf('00000000-0000-4000-8000-%012d', $this->writes);
        $response = $this->send('PUT', "/api/matches/{$id}", ['gameId' => 1, 'firstPersonId' => $first, 'secondPersonId' => $second, 'outcome' => $outcome], $this->session);
        self::assertSame(201, $response->getStatusCode(), (string) $response->getBody());
        $verified = $this->send('PUT', "/api/matches/{$id}/verification", [], $this->verifier);
        self::assertSame(204, $verified->getStatusCode(), (string) $verified->getBody());
    }

    private function standings(?string $ifNoneMatch = null, int $game = 1): ResponseInterface
    {
        $request = $this->request('GET', "/api/games/{$game}/standings")
            ->withCookieParams(['session' => $this->session]);
        if ($ifNoneMatch !== null) {
            $request = $request->withHeader('If-None-Match', $ifNoneMatch);
        }

        return $this->app()->handle($request);
    }
}
