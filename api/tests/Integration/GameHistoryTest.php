<?php

declare(strict_types=1);

namespace Performance\Tests\Integration;

use Performance\Tests\Support\DatabaseTestCase;
use PHPUnit\Framework\Attributes\DataProvider;
use Psr\Http\Message\ResponseInterface;

/**
 * A game's Verlauf at `GET /api/games/{id}/matches` and `GET /api/games/{id}/results`: the
 * current run newest first, a page at a time, with an opaque cursor that stays in its run.
 */
final class GameHistoryTest extends DatabaseTestCase
{
    private const SCHACH = 1;
    private const ROMME = 2;

    private string $session;
    private int $writes = 0;

    protected function setUp(): void
    {
        parent::setUp();
        $this->session = $this->signIn();
        foreach (['Anna', 'Ben', 'Carla'] as $name) {
            $this->send('POST', '/api/persons', ['name' => $name], $this->session);
        }
        $this->send('POST', '/api/games', ['name' => 'Schach', 'kind' => 'duel'], $this->session);
        $this->send('POST', '/api/games', ['name' => 'Rommé', 'kind' => 'points'], $this->session);
    }

    public function testListsADuelGamesMatchesNewestFirstWithPersonsOutcomeTimeAndAccount(): void
    {
        $this->createAccount('anna', 'annas-startpasswort');
        $anna = $this->signIn('anna', 'annas-startpasswort');
        $older = $this->record(1, 2, 'first');
        $this->clock->advance('PT1M');
        $newer = $this->record(3, 1, 'draw', $anna);

        $response = $this->history('matches');

        self::assertSame(200, $response->getStatusCode(), (string) $response->getBody());
        self::assertSame([
            'items' => [
                [
                    'id' => $newer,
                    'first' => ['id' => 3, 'name' => 'Carla'],
                    'second' => ['id' => 1, 'name' => 'Anna'],
                    'outcome' => 'draw',
                    'createdAt' => '2026-11-14T20:01:00.000Z',
                    'accountName' => 'anna',
                ],
                [
                    'id' => $older,
                    'first' => ['id' => 1, 'name' => 'Anna'],
                    'second' => ['id' => 2, 'name' => 'Ben'],
                    'outcome' => 'first',
                    'createdAt' => '2026-11-14T20:00:00.000Z',
                    'accountName' => self::ADMIN,
                ],
            ],
            'next' => null,
        ], $this->body($response));
    }

    public function testListsAPointsGamesResultsNewestFirstWithPersonPointsTimeAndAccount(): void
    {
        $older = $this->score(2, -20);
        $this->clock->advance('PT1M');
        $newer = $this->score(1, 45);

        $response = $this->history('results', game: self::ROMME);

        self::assertSame(200, $response->getStatusCode(), (string) $response->getBody());
        self::assertSame([
            'items' => [
                [
                    'id' => $newer,
                    'person' => ['id' => 1, 'name' => 'Anna'],
                    'points' => 45,
                    'createdAt' => '2026-11-14T20:01:00.000Z',
                    'accountName' => self::ADMIN,
                ],
                [
                    'id' => $older,
                    'person' => ['id' => 2, 'name' => 'Ben'],
                    'points' => -20,
                    'createdAt' => '2026-11-14T20:00:00.000Z',
                    'accountName' => self::ADMIN,
                ],
            ],
            'next' => null,
        ], $this->body($response));
    }

    public function testPagesWithLimitAndCursorAndTheLastPageHasNoNext(): void
    {
        $ids = [];
        for ($i = 0; $i < 5; ++$i) {
            $ids[] = $this->record(1, 2, 'first');
            $this->clock->advance('PT1S');
        }

        self::assertSame([array_slice(array_reverse($ids), 0, 2), array_slice(array_reverse($ids), 2, 2), [$ids[0]]], $this->pages('matches', 2));
        self::assertSame([array_slice(array_reverse($ids), 0, 5)], $this->pages('matches', 5), 'a page that is exactly full has no next');
    }

    public function testTheDefaultPageHoldsTwentyRows(): void
    {
        for ($i = 0; $i < 21; ++$i) {
            $this->score(1, $i);
            $this->clock->advance('PT1S');
        }

        $body = $this->body($this->history('results', game: self::ROMME));

        $next = $body['next'];
        self::assertCount(20, self::itemsOf($body));
        self::assertIsString($next);
        self::assertCount(1, self::itemsOf($this->body($this->history('results', '?before=' . rawurlencode($next), self::ROMME))));
    }

    public function testRowsOfTheSameMillisecondAreNeitherDuplicatedNorSkipped(): void
    {
        $ids = [];
        for ($i = 0; $i < 5; ++$i) {
            $ids[] = $this->score($i % 3 + 1, $i);
        }
        rsort($ids, SORT_STRING);

        self::assertSame([array_slice($ids, 0, 2), array_slice($ids, 2, 2), array_slice($ids, 4)], $this->pages('results', 2, self::ROMME));
    }

    public function testTheFirstPageShowsOnlyTheCurrentRun(): void
    {
        $this->record(1, 2, 'first');
        $this->clock->advance('PT1M');
        $this->restart(self::SCHACH);
        $current = $this->record(2, 3, 'second');

        self::assertSame([[$current]], $this->pages('matches', 20));
    }

    public function testARestartBetweenTwoPagesNeverMixesRuns(): void
    {
        $older = $this->score(1, 10);
        $this->clock->advance('PT1S');
        $newer = $this->score(2, 20);
        $first = $this->body($this->history('results', '?limit=1', self::ROMME));
        $next = $first['next'];
        self::assertSame([$newer], array_column(self::itemsOf($first), 'id'));
        self::assertIsString($next);

        $this->clock->advance('PT1M');
        $this->restart(self::ROMME);
        $this->score(3, 30);
        $second = $this->body($this->history('results', '?limit=1&before=' . rawurlencode($next), self::ROMME));

        self::assertSame([$older], array_column(self::itemsOf($second), 'id'), 'the next page continues in the cursor\'s run');
        self::assertNull($second['next']);
    }

    public function testRowsRecordedBetweenTwoPagesNeitherDuplicateNorSkipOlderRows(): void
    {
        $ids = [];
        for ($i = 0; $i < 4; ++$i) {
            $ids[] = $this->record(1, 2, 'second');
            $this->clock->advance('PT1S');
        }
        $first = $this->body($this->history('matches', '?limit=2'));
        $next = $first['next'];
        self::assertIsString($next);

        $this->record(2, 3, 'first');
        $this->clock->advance('PT1S');
        $this->record(3, 1, 'first');
        $second = $this->body($this->history('matches', '?limit=2&before=' . rawurlencode($next)));

        self::assertSame([$ids[3], $ids[2]], array_column(self::itemsOf($first), 'id'));
        self::assertSame([$ids[1], $ids[0]], array_column(self::itemsOf($second), 'id'));
    }

    public function testADeletedPersonIsNullAndADeletedAccountHasNoName(): void
    {
        $this->createAccount('ben', 'bens-startpasswort');
        $ben = $this->signIn('ben', 'bens-startpasswort');
        $this->record(1, 2, 'first', $ben);
        $this->clock->advance('PT1S');
        $this->record(2, 3, 'second');
        $this->send('DELETE', '/api/persons/2', session: $this->session);
        $this->send('DELETE', '/api/persons/3', session: $this->session);
        $this->otherSession()->exec("DELETE FROM accounts WHERE user_name = 'ben'");

        $items = self::itemsOf($this->body($this->history('matches')));

        self::assertSame([null, null, self::ADMIN], [$items[0]['first'], $items[0]['second'], $items[0]['accountName']], 'both persons deleted, the match stays');
        self::assertSame([['id' => 1, 'name' => 'Anna'], null, null], [$items[1]['first'], $items[1]['second'], $items[1]['accountName']]);
    }

    /**
     * @return iterable<string, array{string, string}>
     */
    public static function invalidPaging(): iterable
    {
        $cursor = static fn(string $json): string => '?before=' . rtrim(strtr(base64_encode($json), '+/', '-_'), '=');

        yield 'limit 0' => ['?limit=0', 'limit'];
        yield 'limit 101' => ['?limit=101', 'limit'];
        yield 'empty limit' => ['?limit=', 'limit'];
        yield 'limit as text' => ['?limit=zehn', 'limit'];
        yield 'fractional limit' => ['?limit=1.5', 'limit'];
        yield 'empty before' => ['?before=', 'before'];
        yield 'before as text' => ['?before=nicht-hier', 'before'];
        yield 'before as a list' => ['?before[]=1', 'before'];
        yield 'a cursor without its run' => [$cursor('["2026-11-14 20:00:00.000","00000000-0000-4000-8000-000000000001"]'), 'before'];
        yield 'a cursor with run 0' => [$cursor('[0,"2026-11-14 20:00:00.000","00000000-0000-4000-8000-000000000001"]'), 'before'];
        yield 'a cursor with an impossible time' => [$cursor('[1,"2026-13-45 20:00:00.000","00000000-0000-4000-8000-000000000001"]'), 'before'];
        yield 'a cursor with another id' => [$cursor('[1,"2026-11-14 20:00:00.000","1; DROP TABLE matches"]'), 'before'];
    }

    #[DataProvider('invalidPaging')]
    public function testAnInvalidLimitOrCursorIsRejectedWith422(string $query, string $field): void
    {
        foreach (['matches' => self::SCHACH, 'results' => self::ROMME] as $rows => $game) {
            $response = $this->history($rows, $query, $game);

            self::assertSame(422, $response->getStatusCode(), (string) $response->getBody());
            $problem = $this->body($response);
            self::assertSame('urn:performance:problem:validation', $problem['type']);
            self::assertIsArray($problem['errors']);
            self::assertSame([$field], array_keys($problem['errors']));
        }
    }

    public function testTheOtherKindOrAnUnknownGameIs404AndTheRoutesNeedASession(): void
    {
        foreach ([['matches', self::ROMME], ['results', self::SCHACH], ['matches', 9], ['results', 9]] as [$rows, $game]) {
            $response = $this->history($rows, game: $game);

            self::assertSame(404, $response->getStatusCode(), "{$rows} of game {$game}");
            self::assertSame('urn:performance:problem:not-found', $this->body($response)['type']);
        }
        self::assertSame(401, $this->send('GET', '/api/games/1/matches')->getStatusCode());
        self::assertSame(401, $this->send('GET', '/api/games/2/results')->getStatusCode());
    }

    /**
     * Follows `next` from the first page to the last, each page's ids in order.
     *
     * @return list<list<string>>
     */
    private function pages(string $rows, int $limit, int $game = self::SCHACH): array
    {
        $pages = [];
        $before = null;
        do {
            $query = "?limit={$limit}" . ($before === null ? '' : '&before=' . rawurlencode($before));
            $response = $this->history($rows, $query, $game);
            self::assertSame(200, $response->getStatusCode(), (string) $response->getBody());
            $body = $this->body($response);
            /** @var list<string> $ids */
            $ids = array_column(self::itemsOf($body), 'id');
            $pages[] = $ids;
            $before = $body['next'];
            if ($before !== null && !is_string($before)) {
                self::fail('next is a cursor or null');
            }
            self::assertLessThan(10, count($pages), 'paging ends');
        } while ($before !== null);

        return $pages;
    }

    /**
     * @param array<string, mixed> $body
     *
     * @return list<array<string, mixed>>
     */
    private static function itemsOf(array $body): array
    {
        self::assertIsArray($body['items']);

        /** @var list<array<string, mixed>> */
        return $body['items'];
    }

    private function history(string $rows, string $query = '', int $game = self::SCHACH): ResponseInterface
    {
        return $this->send('GET', "/api/games/{$game}/{$rows}{$query}", session: $this->session);
    }

    private function restart(int $game): void
    {
        $response = $this->send('POST', "/api/games/{$game}/restart", [], $this->session);
        self::assertSame(200, $response->getStatusCode(), (string) $response->getBody());
    }

    /** Records a match in Schach; returns its id. */
    private function record(int $first, int $second, string $outcome, ?string $session = null): string
    {
        $id = $this->nextId();
        $response = $this->send('PUT', "/api/matches/{$id}", ['gameId' => self::SCHACH, 'firstPersonId' => $first, 'secondPersonId' => $second, 'outcome' => $outcome], $session ?? $this->session);
        self::assertSame(201, $response->getStatusCode(), (string) $response->getBody());

        return $id;
    }

    /** Records a result in Rommé; returns its id. */
    private function score(int $person, int $points): string
    {
        $id = $this->nextId();
        $response = $this->send('PUT', "/api/results/{$id}", ['gameId' => self::ROMME, 'personId' => $person, 'points' => $points], $this->session);
        self::assertSame(201, $response->getStatusCode(), (string) $response->getBody());

        return $id;
    }

    /**
     * A fresh UUID whose order is not the order of recording, so a page ordered by id alone
     * would show.
     */
    private function nextId(): string
    {
        ++$this->writes;

        return sprintf('%08x-0000-4000-8000-%012d', (7919 * $this->writes) % 65536, $this->writes);
    }
}
