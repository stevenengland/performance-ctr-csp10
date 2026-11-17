<?php

declare(strict_types=1);

namespace Performance\Tests\Integration;

use Performance\Tests\Support\DatabaseTestCase;
use PHPUnit\Framework\Attributes\DataProvider;
use Psr\Http\Message\ResponseInterface;

/**
 * A points game's standings over a window or all time ranked by a measure,
 * `measure=sum|average` at `GET /api/games/{id}/standings`: the sum of the verified points
 * (the default) or their average per verified result. Every row carries both; the measure is
 * valid only for a points game with a window or `scope=all`.
 */
final class StandingsMeasureTest extends DatabaseTestCase
{
    private const SCHACH = 1;
    private const ROMME = 2;
    /** A points game whose highest sum wins. */
    private const DARTS = 3;
    private const WINDOW = 'from=2026-11-14T20:00:00Z&to=2026-11-15T20:00:00Z';

    private string $session;
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
        $this->send('POST', '/api/games', ['name' => 'Darts', 'kind' => 'points', 'lowerWins' => false], $this->session);
    }

    /**
     * The average divides the sum by the person's verified results in the selection, whatever
     * their runs: Carla's four results across a restart average 3, her pending one is no
     * attempt. The game's direction applies as to the sum; Anna and Daniel tie at 6, by name.
     */
    public function testTheAverageRanksByTheMeanPerVerifiedResultInTheGamesDirection(): void
    {
        foreach ([self::ROMME, self::DARTS] as $game) {
            $this->score($game, 1, 10);
            $this->score($game, 1, 2);
            $this->score($game, 2, 9);
            $this->score($game, 3, 3);
            $this->score($game, 3, 3);
            $this->score($game, 4, 6);
        }
        $this->clock->advance('PT1H');
        foreach ([self::ROMME, self::DARTS] as $game) {
            $this->send('POST', "/api/games/{$game}/restart", [], $this->session);
            $this->score($game, 3, 3);
            $this->score($game, 3, 3);
            $this->score($game, 3, 40, verified: false);
        }
        $carla = self::pointsRow(3, 'Carla', 12, 3, 4, 1);
        $anna = self::pointsRow(1, 'Anna', 12, 6, 2);
        $daniel = self::pointsRow(4, 'Daniel', 6, 6, 1);
        $ben = self::pointsRow(2, 'Ben', 9, 9, 1);

        foreach (['scope=all', self::WINDOW] as $selection) {
            self::assertSame([$carla, $anna, $daniel, $ben], $this->body($this->standings(self::ROMME, "{$selection}&measure=average"))['rows'], $selection);
            self::assertSame([$ben, $anna, $daniel, $carla], $this->body($this->standings(self::DARTS, "{$selection}&measure=average"))['rows'], $selection);
        }
    }

    /**
     * Without a measure, and with `measure=sum`, the rows are ranked by the sum as before;
     * they carry the average too, rounded half away from zero to one decimal.
     */
    public function testEveryRowCarriesTheSumAndTheAverageAndTheSumRanksByDefault(): void
    {
        $this->score(self::ROMME, 1, 3);
        $this->score(self::ROMME, 1, 4);   // 7 / 2 = 3.5
        $this->score(self::ROMME, 2, 3);
        $this->score(self::ROMME, 2, 3);
        $this->score(self::ROMME, 2, 4);   // 10 / 3 = 3.33…
        $this->score(self::ROMME, 3, 6);
        $this->score(self::ROMME, 3, 7);
        $this->score(self::ROMME, 3, 7);   // 20 / 3 = 6.66…
        $this->score(self::ROMME, 4, 1);
        $this->score(self::ROMME, 4, -1);
        $this->score(self::ROMME, 4, -1);
        $this->score(self::ROMME, 4, 0);   // −1 / 4 = −0.25
        $bySum = [
            self::pointsRow(4, 'Daniel', -1, -0.3, 4),
            self::pointsRow(1, 'Anna', 7, 3.5, 2),
            self::pointsRow(2, 'Ben', 10, 3.3, 3),
            self::pointsRow(3, 'Carla', 20, 6.7, 3),
        ];

        $default = $this->standings(self::ROMME, 'scope=all');
        $sum = $this->standings(self::ROMME, 'scope=all&measure=sum');

        self::assertSame($bySum, $this->body($default)['rows']);
        self::assertSame((string) $default->getBody(), (string) $sum->getBody());
        self::assertSame($bySum, $this->body($this->standings(self::ROMME, self::WINDOW . '&measure=sum'))['rows']);
    }

    /**
     * Where the highest sum wins, the sum ranks highest first over a window and all time
     * across a restart; Ben's and Anna's equal sums break by name although Ben scored first.
     */
    public function testTheSumRanksHighestFirstWhereTheHighestWinsAndTiesBreakByName(): void
    {
        $this->score(self::DARTS, 2, 9);
        $this->score(self::DARTS, 1, 4);
        $this->score(self::DARTS, 1, 5);
        $this->score(self::DARTS, 3, 3);
        $this->score(self::DARTS, 4, 5);
        $this->clock->advance('PT1H');
        $this->send('POST', '/api/games/' . self::DARTS . '/restart', [], $this->session);
        $this->score(self::DARTS, 3, -1);
        $this->score(self::DARTS, 4, 7);
        $bySum = [
            self::pointsRow(4, 'Daniel', 12, 6, 2),
            self::pointsRow(1, 'Anna', 9, 4.5, 2),
            self::pointsRow(2, 'Ben', 9, 9, 1),
            self::pointsRow(3, 'Carla', 2, 1, 2),
        ];

        foreach (['scope=all', self::WINDOW, 'scope=all&measure=sum', self::WINDOW . '&measure=sum'] as $selection) {
            self::assertSame($bySum, $this->body($this->standings(self::DARTS, $selection))['rows'], $selection);
        }
    }

    /**
     * The exact average decides, never one rounded by the database: Ben's 13 / 4 = 3.25 is
     * below Anna's 10 / 3 = 3.33… although both show 3.3, and Daniel's 320 / 107 = 2.99065…
     * is below Carla's 323 / 108 = 2.99074… although MariaDB's own `AVG()` makes both 2.9907,
     * so an order by it would fall back to the name.
     */
    public function testTwoAveragesThatRoundAlikeAreOrderedByTheirExactValues(): void
    {
        foreach ([3, 3, 4] as $points) {
            $this->score(self::ROMME, 1, $points);
        }
        foreach ([3, 3, 3, 4] as $points) {
            $this->score(self::ROMME, 2, $points);
        }
        $this->insertResults(3, array_merge(array_fill(0, 107, 3), [2]));
        $this->insertResults(4, array_merge(array_fill(0, 106, 3), [2]));

        self::assertSame(
            [['average' => '2.9907'], ['average' => '2.9907']],
            $this->rows('SELECT AVG(points) AS average FROM results WHERE person_id IN (3, 4) GROUP BY person_id'),
            'the database rounds both averages alike',
        );
        self::assertSame(
            [
                self::pointsRow(4, 'Daniel', 320, 3, 107),
                self::pointsRow(3, 'Carla', 323, 3, 108),
                self::pointsRow(2, 'Ben', 13, 3.3, 4),
                self::pointsRow(1, 'Anna', 10, 3.3, 3),
            ],
            $this->body($this->standings(self::ROMME, 'scope=all&measure=average'))['rows'],
        );
    }

    /** Equal exact averages tie however their sums differ, and break by name. */
    public function testEqualAveragesBreakByName(): void
    {
        $this->score(self::DARTS, 2, 4);
        $this->score(self::DARTS, 1, 3);
        $this->score(self::DARTS, 1, 5);

        self::assertSame(
            [self::pointsRow(1, 'Anna', 8, 4, 2), self::pointsRow(2, 'Ben', 4, 4, 1)],
            $this->body($this->standings(self::DARTS, 'scope=all&measure=average'))['rows'],
        );
    }

    /**
     * @return iterable<string, array{int, string, array<string, string>}>
     */
    public static function rejectedMeasures(): iterable
    {
        $known = ['measure' => 'Nur sum oder average.'];
        $period = ['measure' => 'Nur mit from oder scope=all.'];
        $points = ['measure' => 'Nur bei Punktespielen.'];

        yield 'an unknown measure' => [self::ROMME, 'scope=all&measure=median', $known];
        yield 'a measure in capitals' => [self::ROMME, 'scope=all&measure=SUM', $known];
        yield 'an empty measure' => [self::ROMME, self::WINDOW . '&measure=', $known];
        yield 'a measure that is a list' => [self::ROMME, 'scope=all&measure[]=average', $known];
        yield 'the sum in the current run' => [self::ROMME, 'measure=sum', $period];
        yield 'the average in the current run' => [self::ROMME, 'measure=average', $period];
        yield 'an unknown measure in the current run' => [self::ROMME, 'measure=median', $known];
        yield 'the sum of a duel' => [self::SCHACH, 'scope=all&measure=sum', $points];
        yield 'the average of a duel in a window' => [self::SCHACH, self::WINDOW . '&measure=average', $points];
        yield 'the average of a duel in the current run' => [self::SCHACH, 'measure=average', $period];
    }

    /**
     * A rejected measure is a validation problem even for the tag of the current run, so it
     * can never answer, let alone change, the current run's ranking.
     *
     * @param array<string, string> $errors
     */
    #[DataProvider('rejectedMeasures')]
    public function testAMeasureIsRejectedOutsideAPointsGamesWindowOrAllTime(int $game, string $query, array $errors): void
    {
        $this->score(self::ROMME, 1, 5);
        $currentRun = $this->standings($game);

        $rejected = $this->standings($game, $query, $currentRun->getHeaderLine('ETag'));

        self::assertSame(422, $rejected->getStatusCode(), (string) $rejected->getBody());
        self::assertSame('application/problem+json', $rejected->getHeaderLine('Content-Type'));
        self::assertSame($errors, $this->body($rejected)['errors']);
        self::assertSame((string) $currentRun->getBody(), (string) $this->standings($game)->getBody());
    }

    /** The measure is checked before the game is read: in the current run even an unknown game is a validation problem. */
    public function testAMeasureInTheCurrentRunIsRejectedBeforeTheGameIsLookedUp(): void
    {
        self::assertSame(422, $this->standings(99, 'measure=average')->getStatusCode());
        self::assertSame(404, $this->standings(99, 'scope=all&measure=average')->getStatusCode());
    }

    /**
     * The ETag names the measure beside the selection: the sum, sent or not, keeps the
     * selection's tag, the average adds its own part; 304 only for the same one.
     */
    public function testTheTagDiffersPerMeasureWithinTheSameSelection(): void
    {
        $this->score(self::ROMME, 1, 5);
        $revision = (int) trim($this->standings(self::ROMME)->getHeaderLine('ETag'), '"');
        $sum = sprintf('"%d-all"', $revision);
        $average = sprintf('"%d-all-average"', $revision);

        self::assertSame($sum, $this->standings(self::ROMME, 'scope=all')->getHeaderLine('ETag'));
        self::assertSame($sum, $this->standings(self::ROMME, 'scope=all&measure=sum')->getHeaderLine('ETag'));
        self::assertSame($average, $this->standings(self::ROMME, 'scope=all&measure=average')->getHeaderLine('ETag'));
        self::assertSame(
            sprintf('"%d-1794686400000-1794772800000-average"', $revision),
            $this->standings(self::ROMME, self::WINDOW . '&measure=average')->getHeaderLine('ETag'),
        );
        self::assertSame(304, $this->standings(self::ROMME, 'scope=all&measure=average', $average)->getStatusCode());
        self::assertSame(200, $this->standings(self::ROMME, 'scope=all&measure=average', $sum)->getStatusCode());
        self::assertSame(200, $this->standings(self::ROMME, 'scope=all&measure=sum', $average)->getStatusCode());
    }

    /**
     * A person whose results in the selection all wait is unranked under either measure, with
     * no average: nothing is divided by their zero verified results.
     */
    public function testAPersonWhoseResultsAllWaitIsUnrankedWithoutAnAverage(): void
    {
        $this->score(self::ROMME, 1, 0);
        $this->score(self::ROMME, 2, 4, verified: false);
        $this->score(self::ROMME, 2, 6, verified: false);

        foreach (['sum', 'average'] as $measure) {
            $standings = $this->standings(self::ROMME, "scope=all&measure={$measure}");

            self::assertSame(200, $standings->getStatusCode(), (string) $standings->getBody());
            self::assertSame(
                ['rows' => [self::pointsRow(1, 'Anna', 0, 0, 1)], 'unranked' => [['personId' => 2, 'name' => 'Ben', 'pendingCount' => 2]]],
                array_slice($this->body($standings), 3),
                $measure,
            );
        }
    }

    /**
     * @return array{personId: int, name: string, sum: int, average: int|float, results: int, pendingCount: int}
     */
    private static function pointsRow(int $personId, string $name, int $sum, int|float $average, int $results, int $pendingCount = 0): array
    {
        return ['personId' => $personId, 'name' => $name, 'sum' => $sum, 'average' => $average, 'results' => $results, 'pendingCount' => $pendingCount];
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

    /** Records a result; it counts as verified unless it should wait. */
    private function score(int $game, int $person, int $points, bool $verified = true): void
    {
        ++$this->writes;
        $id = sprintf('00000000-0000-4000-8000-%012d', $this->writes);
        $response = $this->send('PUT', "/api/results/{$id}", ['gameId' => $game, 'personId' => $person, 'points' => $points], $this->session);
        self::assertSame(201, $response->getStatusCode(), (string) $response->getBody());
        if ($verified) {
            $this->verifyDirectly('results', $id);
        }
    }

    /**
     * Inserts verified Rommé results of the person directly, too many to record one by one.
     *
     * @param list<int> $points
     */
    private function insertResults(int $person, array $points): void
    {
        $rows = [];
        foreach ($points as $index => $value) {
            $rows[] = sprintf("('00000000-0000-4000-a%03d-%012d', %d, %d, %d, 1, NULL, '2026-11-14 20:00:00.000', 0)", $person, $index, self::ROMME, $person, $value);
        }
        $this->otherSession()->exec('INSERT INTO results (id, game_id, person_id, points, run, account_id, created_at, pending) VALUES ' . implode(', ', $rows));
    }
}
