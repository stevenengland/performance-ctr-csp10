<?php

declare(strict_types=1);

namespace Performance\Tests\Integration;

use Performance\Tests\Support\DatabaseTestCase;
use Psr\Http\Message\ResponseInterface;

/**
 * A game's ranking over a window `[from, to)` or all time (`scope=all`) at
 * `GET /api/games/{id}/standings`: every verified match or result recorded in it counts,
 * whatever its run; without either the answer is the current run's, as before.
 */
final class StandingsWindowTest extends DatabaseTestCase
{
    /** The test clock's start, 2026-11-14 20:00 UTC, in milliseconds. */
    private const START_MS = '1794686400000';

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
     * Installed clients send no parameter: their answer of the current run, body and ETag, is
     * pinned byte for byte as it was before the standings took a window.
     */
    public function testARequestWithoutParametersAnswersTheCurrentRunByteForByteAsBefore(): void
    {
        $this->record(1, 2, 'first');
        $this->score(3, 12);
        $this->clock->advance('PT1H');
        $this->send('POST', '/api/games/1/restart', [], $this->session);
        $this->send('POST', '/api/games/2/restart', [], $this->session);
        $this->record(3, 1, 'draw');
        $this->record(4, 3, 'second');
        $this->record(2, 4, 'first', verified: false);
        $this->score(1, 7);
        $this->score(2, -3);
        $this->score(2, 5);
        $this->score(4, 9, verified: false);

        $duel = $this->standings(1);
        $points = $this->standings(2);

        self::assertSame([200, '"24"'], [$duel->getStatusCode(), $duel->getHeaderLine('ETag')]);
        self::assertSame(
            '{"kind":"duel","startedAt":"2026-11-14T21:00:00.000Z","rows":[{"personId":3,"name":"Carla","points":1.5,"wins":1,"draws":1,"losses":0,"played":2,"pendingCount":0},{"personId":1,"name":"Anna","points":0.5,"wins":0,"draws":1,"losses":0,"played":1,"pendingCount":0},{"personId":4,"name":"Daniel","points":0,"wins":0,"draws":0,"losses":1,"played":1,"pendingCount":1}],"unranked":[{"personId":2,"name":"Ben","pendingCount":1}]}',
            (string) $duel->getBody(),
        );
        self::assertSame([200, '"24"'], [$points->getStatusCode(), $points->getHeaderLine('ETag')]);
        self::assertSame(
            '{"kind":"points","startedAt":"2026-11-14T21:00:00.000Z","lowerWins":true,"rows":[{"personId":2,"name":"Ben","sum":2,"results":2,"pendingCount":0},{"personId":1,"name":"Anna","sum":7,"results":1,"pendingCount":0}],"unranked":[{"personId":4,"name":"Daniel","pendingCount":1}]}',
            (string) $points->getBody(),
        );
    }

    /**
     * Across a restart a duel accumulates: each verified match adds its win, draw or loss to
     * both its players once, ordered by points, then wins, then name. A window ends before
     * its `to`: the matches recorded at 21:00 are not in the window that ends then.
     */
    public function testADuelAccumulatesTheMatchesOfEveryRunInTheSelection(): void
    {
        $this->record(1, 2, 'first');  // Anna 1, Ben 0
        $this->record(1, 2, 'draw');   // Anna ½, Ben ½
        $this->clock->advance('PT1H');
        $this->send('POST', '/api/games/1/restart', [], $this->session);
        $this->record(2, 1, 'first');  // Ben 1, Anna 0
        $this->record(3, 1, 'second'); // Anna 1, Carla 0
        $this->record(3, 2, 'draw');   // Carla ½, Ben ½
        $this->record(4, 3, 'first');  // Daniel 1, Carla 0
        $this->record(4, 3, 'first');  // Daniel 1, Carla 0

        $allTime = $this->body($this->standings(1, 'scope=all'));
        $firstRun = $this->body($this->standings(1, 'from=2026-11-14T20:00:00Z&to=2026-11-14T21:00:00Z'));
        $secondRun = $this->body($this->standings(1, 'from=2026-11-14T21:00:00Z'));

        self::assertSame('2026-11-14T21:00:00.000Z', $allTime['startedAt'], 'the current run still starts at the restart');
        self::assertSame(
            [
                self::duelRow(1, 'Anna', 2.5, 2, 1, 1),
                self::duelRow(4, 'Daniel', 2, 2, 0, 0),
                self::duelRow(2, 'Ben', 2, 1, 2, 1),
                self::duelRow(3, 'Carla', 0.5, 0, 1, 3),
            ],
            $allTime['rows'],
        );
        self::assertSame([self::duelRow(1, 'Anna', 1.5, 1, 1, 0), self::duelRow(2, 'Ben', 0.5, 0, 1, 1)], $firstRun['rows']);
        self::assertSame(
            [
                self::duelRow(4, 'Daniel', 2, 2, 0, 0),
                self::duelRow(2, 'Ben', 1.5, 1, 1, 0),
                self::duelRow(1, 'Anna', 1, 1, 0, 1),
                self::duelRow(3, 'Carla', 0.5, 0, 1, 3),
            ],
            $secondRun['rows'],
        );
        self::assertSame($secondRun['rows'], $this->body($this->standings(1))['rows'], 'the current run is the second');
    }

    /** Across a restart a points game adds up every verified result as one attempt each, in its direction. */
    public function testAPointsGameAccumulatesTheResultsOfEveryRunInTheSelection(): void
    {
        $this->score(1, 10);
        $this->score(2, 4);
        $this->clock->advance('PT1H');
        $this->send('POST', '/api/games/2/restart', [], $this->session);
        $this->score(1, -3);
        $this->score(1, 5);
        $this->score(3, 6);

        $allTime = $this->body($this->standings(2, 'scope=all'));
        $firstRun = $this->body($this->standings(2, 'from=2026-11-14T20:00:00Z&to=2026-11-14T21:00:00Z'));

        self::assertSame(
            ['kind' => 'points', 'startedAt' => '2026-11-14T21:00:00.000Z', 'lowerWins' => true],
            array_slice($allTime, 0, 3),
        );
        self::assertSame([self::pointsRow(2, 'Ben', 4, 1), self::pointsRow(3, 'Carla', 6, 1), self::pointsRow(1, 'Anna', 12, 3)], $allTime['rows']);
        self::assertSame([self::pointsRow(2, 'Ben', 4, 1), self::pointsRow(1, 'Anna', 10, 1)], $firstRun['rows']);
    }

    /**
     * Only verified rows count; each person names the rows of theirs that wait in the window,
     * and a person whose rows in it all wait is listed apart. A row waiting outside the window
     * is not named.
     */
    public function testInAWindowPendingRowsDoNotCountAndAPersonWhoseRowsAllWaitIsUnranked(): void
    {
        $this->record(1, 2, 'first');
        $this->record(3, 4, 'first', verified: false);
        $this->record(1, 3, 'draw', verified: false);
        $this->score(1, 5);
        $this->score(1, 6, verified: false);
        $this->score(2, 3, verified: false);
        $this->clock->advance('PT1H');
        $this->record(1, 4, 'first', verified: false);
        $this->score(1, 2, verified: false);
        $window = 'from=2026-11-14T20:00:00Z&to=2026-11-14T21:00:00Z';

        $duel = $this->body($this->standings(1, $window));
        $points = $this->body($this->standings(2, $window));

        self::assertSame([self::duelRow(1, 'Anna', 1, 1, 0, 0, 1), self::duelRow(2, 'Ben', 0, 0, 0, 1)], $duel['rows']);
        self::assertSame(
            [['personId' => 3, 'name' => 'Carla', 'pendingCount' => 2], ['personId' => 4, 'name' => 'Daniel', 'pendingCount' => 1]],
            $duel['unranked'],
        );
        self::assertSame([self::pointsRow(1, 'Anna', 5, 1, 1)], $points['rows']);
        self::assertSame([['personId' => 2, 'name' => 'Ben', 'pendingCount' => 1]], $points['unranked']);
    }

    /**
     * The ETag names the revision and the selection: a window's start, its end, or all time.
     * It answers 304 only for the same revision and the same selection.
     */
    public function testTheTagNamesTheSelectionAndAnswers304OnlyForTheSameOne(): void
    {
        $this->record(1, 2, 'first');
        $selections = [
            '' => '"%d"',
            'from=2026-11-14T20:00:00Z' => '"%d-' . self::START_MS . '"',
            'from=2026-11-14T20:00:00Z&to=2026-11-14T21:00:00Z' => '"%d-' . self::START_MS . '-1794690000000"',
            'from=2026-11-14T21:00:00%2B01:00&to=2026-11-14T22:00:00Z' => '"%d-' . self::START_MS . '-1794693600000"',
            'scope=all' => '"%d-all"',
        ];
        $revision = (int) trim($this->standings(1)->getHeaderLine('ETag'), '"');

        foreach ($selections as $query => $tag) {
            $response = $this->standings(1, $query);
            self::assertSame(sprintf($tag, $revision), $response->getHeaderLine('ETag'), $query);
            self::assertSame(304, $this->standings(1, $query, sprintf($tag, $revision))->getStatusCode(), $query);
            foreach ($selections as $other => $otherTag) {
                if ($otherTag !== $tag) {
                    self::assertSame(200, $this->standings(1, $query, sprintf($otherTag, $revision))->getStatusCode(), "{$query} with the tag of {$other}");
                }
            }
        }

        $this->record(3, 4, 'draw');

        self::assertSame(200, $this->standings(1, 'scope=all', sprintf('"%d-all"', $revision))->getStatusCode(), 'a write is a new revision');
    }

    /** A deleted person's side counts for no one in a window, as in a run, and the other side keeps its result. */
    public function testADeletedPersonCountsForNoOneInAWindow(): void
    {
        $this->record(1, 2, 'first');
        $this->record(2, 3, 'first');
        $this->score(2, 4);
        $this->score(3, 9);

        $deleted = $this->send('DELETE', '/api/persons/2', session: $this->session);

        self::assertSame(204, $deleted->getStatusCode(), (string) $deleted->getBody());
        $window = 'from=2026-11-14T20:00:00Z&to=2026-11-14T21:00:00Z';
        foreach (['scope=all', $window] as $query) {
            self::assertSame([self::duelRow(1, 'Anna', 1, 1, 0, 0), self::duelRow(3, 'Carla', 0, 0, 0, 1)], $this->body($this->standings(1, $query))['rows'], $query);
            self::assertSame([self::pointsRow(3, 'Carla', 9, 1)], $this->body($this->standings(2, $query))['rows'], $query);
        }
    }

    /** A row recorded before a window's end and verified after it stays in the window it was recorded in. */
    public function testARowVerifiedAfterTheWindowStaysInTheWindowItWasRecordedIn(): void
    {
        $this->clock->advance('PT2H59M59S'); // 22:59:59 UTC, just before midnight in Berlin
        $match = $this->record(1, 2, 'first', verified: false);
        $result = $this->score(1, 5, verified: false);
        $this->clock->advance('PT1H');
        $this->verify('matches', $match);
        $this->verify('results', $result);
        $recordedIn = 'from=2026-11-13T23:00:00Z&to=2026-11-14T23:00:00Z';
        $verifiedIn = 'from=2026-11-14T23:00:00Z&to=2026-11-15T23:00:00Z';

        self::assertSame([self::duelRow(1, 'Anna', 1, 1, 0, 0), self::duelRow(2, 'Ben', 0, 0, 0, 1)], $this->body($this->standings(1, $recordedIn))['rows']);
        self::assertSame([self::pointsRow(1, 'Anna', 5, 1)], $this->body($this->standings(2, $recordedIn))['rows']);
        self::assertSame(['rows' => [], 'unranked' => []], array_slice($this->body($this->standings(1, $verifiedIn)), 2));
        self::assertSame(['rows' => [], 'unranked' => []], array_slice($this->body($this->standings(2, $verifiedIn)), 3));
    }

    /**
     * @return array{personId: int, name: string, points: int|float, wins: int, draws: int, losses: int, played: int, pendingCount: int}
     */
    private static function duelRow(int $personId, string $name, int|float $points, int $wins, int $draws, int $losses, int $pendingCount = 0): array
    {
        return [
            'personId' => $personId,
            'name' => $name,
            'points' => $points,
            'wins' => $wins,
            'draws' => $draws,
            'losses' => $losses,
            'played' => $wins + $draws + $losses,
            'pendingCount' => $pendingCount,
        ];
    }

    /**
     * @return array{personId: int, name: string, sum: int, results: int, pendingCount: int}
     */
    private static function pointsRow(int $personId, string $name, int $sum, int $results, int $pendingCount = 0): array
    {
        return ['personId' => $personId, 'name' => $name, 'sum' => $sum, 'results' => $results, 'pendingCount' => $pendingCount];
    }

    private function standings(int $game, string $query = '', ?string $ifNoneMatch = null): ResponseInterface
    {
        $request = $this->request('GET', "/api/games/{$game}/standings" . ($query === '' ? '' : "?{$query}"))
            ->withCookieParams(['session' => $this->session]);
        if ($ifNoneMatch !== null) {
            $request = $request->withHeader('If-None-Match', $ifNoneMatch);
        }

        return $this->app()->handle($request);
    }

    /** Records a result in Rommé; another account verifies it unless it should wait. */
    private function score(int $person, int $points, bool $verified = true): string
    {
        return $this->write('results', ['gameId' => 2, 'personId' => $person, 'points' => $points], $verified);
    }

    /** Records a match in Schach; another account verifies it unless it should wait. */
    private function record(int $first, int $second, string $outcome, bool $verified = true): string
    {
        return $this->write('matches', ['gameId' => 1, 'firstPersonId' => $first, 'secondPersonId' => $second, 'outcome' => $outcome], $verified);
    }

    /**
     * @param array<string, int|string> $json
     */
    private function write(string $collection, array $json, bool $verified): string
    {
        ++$this->writes;
        $id = sprintf('00000000-0000-4000-8000-%012d', $this->writes);
        $response = $this->send('PUT', "/api/{$collection}/{$id}", $json, $this->session);
        self::assertSame(201, $response->getStatusCode(), (string) $response->getBody());
        if ($verified) {
            $this->verify($collection, $id);
        }

        return $id;
    }

    /** Another account verifies the recorded match or result. */
    private function verify(string $collection, string $id): void
    {
        $verification = $this->send('PUT', "/api/{$collection}/{$id}/verification", [], $this->verifier);
        self::assertSame(204, $verification->getStatusCode(), (string) $verification->getBody());
    }
}
