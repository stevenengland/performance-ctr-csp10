<?php

declare(strict_types=1);

namespace Performance\Tests\Integration;

use Performance\Domain\Actor;
use Performance\Domain\AuditLog;
use Performance\Domain\DataRevision;
use Performance\Domain\Games\DuelRow;
use Performance\Domain\Games\Matches;
use Performance\Domain\Idempotency;
use Performance\Domain\Snapshot;
use Performance\Tests\Support\DatabaseTestCase;
use PHPUnit\Framework\Attributes\DataProvider;
use Psr\Http\Message\ResponseInterface;
use Slim\Psr7\Factory\ServerRequestFactory;

/** A game's ranking at `GET /api/games/{id}/standings`, with its ETag. */
final class StandingsTest extends DatabaseTestCase
{
    private const NOW = '2026-11-14T20:00:00.000Z';

    private string $session;
    private int $matches = 0;

    protected function setUp(): void
    {
        parent::setUp();
        $this->session = $this->signIn();
        foreach (['Anna', 'Ben', 'Carla', 'Daniel'] as $name) {
            $this->send('POST', '/api/persons', ['name' => $name], $this->session);
        }
        $this->send('POST', '/api/games', ['name' => 'Schach', 'kind' => 'duel'], $this->session);
        $this->send('POST', '/api/games', ['name' => 'Rommé', 'kind' => 'points', 'lowerWins' => true], $this->session);
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
        self::assertSame(['kind' => 'duel', 'startedAt' => self::NOW, 'rows' => []], $this->body($this->standings()));
    }

    public function testAPointsGameAnswersItsKindWithNoRows(): void
    {
        $response = $this->standings(game: 2);

        self::assertSame(200, $response->getStatusCode());
        self::assertSame(['kind' => 'points', 'startedAt' => self::NOW, 'lowerWins' => true, 'rows' => []], $this->body($response));
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

        [$read, $rows] = (new Snapshot($reader))->read(static function () use ($revision, $matches, $writer): array {
            $read = $revision->current();
            // Another request commits a match between the reads of this one.
            $writer->exec(
                "INSERT INTO matches (id, game_id, first_person_id, second_person_id, outcome, run, account_id, created_at)
                 VALUES ('00000000-0000-4000-8000-000000000999', 1, 3, 4, 'first', 1, 1, '2026-11-14 20:00:00.000')",
            );
            $writer->exec('UPDATE data_revision SET revision = revision + 1');

            return [$read, $matches->standings(1, 1)];
        });

        self::assertSame(['Anna', 'Ben'], array_map(static fn(DuelRow $row): string => $row->name, $rows), 'the ranking belongs to the revision that was read');
        self::assertCount(4, $matches->standings(1, 1), 'a read after the snapshot sees the write');
        self::assertSame($read + 1, $revision->current());
    }

    /**
     * @return array{personId: int, name: string, points: int|float, wins: int, draws: int, losses: int, played: int}
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
        ];
    }

    private function record(int $first, int $second, string $outcome): void
    {
        ++$this->matches;
        $id = sprintf('00000000-0000-4000-8000-%012d', $this->matches);
        $response = $this->send('PUT', "/api/matches/{$id}", ['gameId' => 1, 'firstPersonId' => $first, 'secondPersonId' => $second, 'outcome' => $outcome], $this->session);
        self::assertSame(201, $response->getStatusCode(), (string) $response->getBody());
    }

    private function standings(?string $ifNoneMatch = null, int $game = 1): ResponseInterface
    {
        $request = (new ServerRequestFactory())
            ->createServerRequest('GET', "/api/games/{$game}/standings")
            ->withCookieParams(['session' => $this->session]);
        if ($ifNoneMatch !== null) {
            $request = $request->withHeader('If-None-Match', $ifNoneMatch);
        }

        return $this->app()->handle($request);
    }
}
