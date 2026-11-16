<?php

declare(strict_types=1);

namespace Performance\Tests\Integration;

use Performance\Domain\PendingItem;
use Performance\Http\Database;
use Performance\Tests\Support\DatabaseTestCase;
use Psr\Http\Message\ResponseInterface;

/**
 * `GET /api/pending`: the rows the acting account may verify, entries and matches, across all
 * days and game runs, newest first, a bounded page at a time, with the count of all of them
 * (PRD #61).
 */
final class PendingQueueTest extends DatabaseTestCase
{
    private const ANNA_PASSWORD = 'annas-startpasswort';
    private const BEN_PASSWORD = 'bens-startpasswort';

    /** The bootstrap admin's session (account 1). */
    private string $chef;
    /** Anna's session (account 2). */
    private string $anna;
    private int $entries = 0;

    protected function setUp(): void
    {
        parent::setUp();
        $this->chef = $this->signIn();
        $this->createAccount('anna', self::ANNA_PASSWORD);
        $this->anna = $this->signIn('anna', self::ANNA_PASSWORD);
        $this->send('POST', '/api/persons', ['name' => 'Daniel'], $this->chef);
        $this->send('POST', '/api/drinks', ['name' => 'Bier', 'points' => 1], $this->chef);
        $this->send('POST', '/api/factors', ['name' => 'Happy Hour', 'multiplier' => 2], $this->chef);
    }

    public function testListsTheEntriesTheAccountMayVerifyAcrossAllDaysNewestFirstWithTheirCount(): void
    {
        $yesterday = $this->record($this->chef, quantity: 2, factorId: 1);
        $this->clock->advance('P1D');
        $own = $this->record($this->anna);
        $verified = $this->record($this->chef);
        $this->verify($verified, $this->anna);
        $this->clock->advance('PT1M');
        $today = $this->record($this->chef);

        $queue = $this->body($this->pending($this->anna));

        self::assertSame(2, $queue['count']);
        self::assertNull($queue['next']);
        self::assertSame(
            [
                [
                    'kind' => 'entry',
                    'id' => $today,
                    'createdAt' => '2026-11-15T20:01:00.000Z',
                    'accountName' => self::ADMIN,
                    'person' => ['id' => 1, 'name' => 'Daniel'],
                    'drink' => ['id' => 1, 'name' => 'Bier'],
                    'quantity' => 1,
                    'factor' => null,
                ],
                [
                    'kind' => 'entry',
                    'id' => $yesterday,
                    'createdAt' => '2026-11-14T20:00:00.000Z',
                    'accountName' => self::ADMIN,
                    'person' => ['id' => 1, 'name' => 'Daniel'],
                    'drink' => ['id' => 1, 'name' => 'Bier'],
                    'quantity' => 2,
                    'factor' => ['id' => 1, 'name' => 'Happy Hour', 'multiplier' => 2],
                ],
            ],
            $queue['items'],
        );
        self::assertSame([$own], $this->idsIn($this->body($this->pending($this->chef))), 'the recorder sees only the others\' entries');
    }

    public function testEntriesOfOneInstantFollowInIdOrder(): void
    {
        $ids = [$this->record($this->chef), $this->record($this->chef), $this->record($this->chef)];

        self::assertSame($ids, $this->idsIn($this->body($this->pending($this->anna))));
    }

    public function testAnEntryWhoseRecorderWasDeletedIsInEveryQueueWithoutARecorderName(): void
    {
        $this->createAccount('ben', self::BEN_PASSWORD);
        $entry = $this->record($this->signIn('ben', self::BEN_PASSWORD));
        $this->send('DELETE', '/api/accounts/3', session: $this->chef);

        $queue = $this->body($this->pending($this->anna));

        self::assertSame([$entry], $this->idsIn($queue));
        self::assertIsList($queue['items']);
        self::assertIsArray($queue['items'][0]);
        self::assertNull($queue['items'][0]['accountName']);
        self::assertSame([$entry], $this->idsIn($this->body($this->pending($this->chef))));
    }

    public function testPagingReachesEveryRemainingEntryWhileEarlierOnesAreVerified(): void
    {
        $older = array_map(fn(): string => $this->record($this->chef), range(1, 13));
        $this->clock->advance('PT1M');
        $newer = array_map(fn(): string => $this->record($this->chef), range(1, 12));

        $first = $this->body($this->pending($this->anna));
        foreach (array_slice($newer, 0, 6) as $handled) {
            $this->verify($handled, $this->anna);
        }
        self::assertIsString($first['next']);
        $second = $this->body($this->pending($this->anna, $first['next']));

        self::assertSame([...$newer, ...array_slice($older, 0, 8)], $this->idsIn($first));
        self::assertSame(25, $first['count']);
        self::assertSame(array_slice($older, 8), $this->idsIn($second));
        self::assertNull($second['next']);
        self::assertSame(19, $second['count'], 'the count covers every page');
    }

    /**
     * A pending match is listed with its game, both players, its outcome and its recorder, and
     * marked when it belongs to an earlier run of its game; a cleared side is null.
     */
    public function testListsPendingMatchesWithGamePlayersOutcomeAndRecorderAndMarksAnEarlierRun(): void
    {
        $this->send('POST', '/api/persons', ['name' => 'Erik'], $this->chef);
        $this->send('POST', '/api/persons', ['name' => 'Fritz'], $this->chef);
        $this->send('POST', '/api/games', ['name' => 'Schach', 'kind' => 'duel'], $this->chef);
        $earlier = $this->recordMatch($this->chef, 1, 2, 'first');
        $this->send('POST', '/api/games/1/restart', [], $this->chef);
        $this->clock->advance('PT1M');
        $current = $this->recordMatch($this->chef, 3, 2, 'draw');
        $this->send('DELETE', '/api/persons/3', session: $this->chef);

        $queue = $this->body($this->pending($this->anna));

        self::assertSame(2, $queue['count']);
        self::assertSame(
            [
                [
                    'kind' => 'match',
                    'id' => $current,
                    'createdAt' => '2026-11-14T20:01:00.000Z',
                    'accountName' => self::ADMIN,
                    'game' => ['id' => 1, 'name' => 'Schach'],
                    'earlierRun' => false,
                    'first' => null,
                    'second' => ['id' => 2, 'name' => 'Erik'],
                    'outcome' => 'draw',
                ],
                [
                    'kind' => 'match',
                    'id' => $earlier,
                    'createdAt' => '2026-11-14T20:00:00.000Z',
                    'accountName' => self::ADMIN,
                    'game' => ['id' => 1, 'name' => 'Schach'],
                    'earlierRun' => true,
                    'first' => ['id' => 1, 'name' => 'Daniel'],
                    'second' => ['id' => 2, 'name' => 'Erik'],
                    'outcome' => 'first',
                ],
            ],
            $queue['items'],
        );
        self::assertSame(0, $this->body($this->pending($this->chef))['count'], 'the recorder may verify none of them');
    }

    /**
     * Rows of one instant follow by kind (`entry` before `match`), then by id, and a page that
     * ends on one kind goes on with the rest of both.
     */
    public function testRowsOfOneInstantFollowByKindThenIdAcrossPages(): void
    {
        $this->send('POST', '/api/persons', ['name' => 'Erik'], $this->chef);
        $this->send('POST', '/api/games', ['name' => 'Schach', 'kind' => 'duel'], $this->chef);
        $matches = array_map(fn(): string => $this->recordMatch($this->chef, 1, 2, 'first'), range(1, 19));
        $entries = [$this->record($this->chef), $this->record($this->chef)];

        $first = $this->body($this->pending($this->anna));
        self::assertIsString($first['next']);
        $second = $this->body($this->pending($this->anna, $first['next']));

        self::assertSame([...$entries, ...array_slice($matches, 0, 18)], $this->idsIn($first));
        self::assertSame([$matches[18]], $this->idsIn($second));
        self::assertSame(21, $second['count']);
    }

    public function testACursorThatNamesNoPositionIs422(): void
    {
        $response = $this->send('GET', '/api/pending?cursor=nonsense', session: $this->anna);

        self::assertSame(422, $response->getStatusCode());
        self::assertSame(['cursor' => 'Unbekannte Seite.'], $this->body($response)['errors']);
    }

    public function testAnUnchangedRevisionAnswers304OnlyToTheSameAccount(): void
    {
        $this->record($this->chef);
        $tag = $this->pending($this->anna)->getHeaderLine('ETag');

        $again = $this->send('GET', '/api/pending', session: $this->anna, headers: ['If-None-Match' => $tag]);
        $other = $this->send('GET', '/api/pending', session: $this->chef, headers: ['If-None-Match' => $tag]);

        self::assertSame(304, $again->getStatusCode());
        self::assertSame(200, $other->getStatusCode(), 'another account has its own queue');
        self::assertSame(0, $this->body($other)['count']);
    }

    public function testDeletingTheRecordersAccountChangesTheQueueAConditionalReadGets(): void
    {
        $this->createAccount('ben', self::BEN_PASSWORD);
        $this->record($this->signIn('ben', self::BEN_PASSWORD));
        $tag = $this->pending($this->anna)->getHeaderLine('ETag');

        $this->send('DELETE', '/api/accounts/3', session: $this->chef);
        $response = $this->send('GET', '/api/pending', session: $this->anna, headers: ['If-None-Match' => $tag]);

        self::assertSame(200, $response->getStatusCode());
        $items = $this->body($response)['items'];
        self::assertIsList($items);
        self::assertIsArray($items[0]);
        self::assertNull($items[0]['accountName'], 'the recorder is unknown now');
    }

    public function testTheRevisionTheItemsAndTheCountReadOneSnapshot(): void
    {
        $entry = $this->record($this->chef);
        $reader = new Database($this->config(), $this->clock);
        $writer = $this->otherSession();

        [$revision, $page] = $reader->snapshot()->read(static function () use ($reader, $writer): array {
            $revision = $reader->revision()->current();
            // Another request commits a change between the reads of this one.
            $writer->exec('DELETE FROM entries');
            $writer->exec('UPDATE data_revision SET revision = revision + 1');

            return [$revision, $reader->verification()->queue(2, null)];
        });

        self::assertSame([$entry], array_map(static fn(PendingItem $item): string => $item->id, $page->items), 'the items belong to the revision that was read');
        self::assertSame(1, $page->count);
        self::assertSame(0, $reader->verification()->queue(2, null)->count, 'a read after the snapshot sees the change');
        self::assertSame($revision + 1, $reader->revision()->current());
    }

    /**
     * Records an entry for Daniel, which waits for verification; the clock stands still, so
     * entries recorded one after another share their instant.
     */
    private function record(string $session, int $quantity = 1, ?int $factorId = null): string
    {
        ++$this->entries;
        $id = sprintf('00000000-0000-4000-8000-%012d', $this->entries);
        $response = $this->send('PUT', "/api/entries/{$id}", ['personId' => 1, 'drinkId' => 1, 'quantity' => $quantity, 'factorId' => $factorId], $session);
        self::assertSame(201, $response->getStatusCode(), (string) $response->getBody());

        return $id;
    }

    /** Records a match in Schach, numbered with the entries; it waits for verification. */
    private function recordMatch(string $session, int $first, int $second, string $outcome): string
    {
        ++$this->entries;
        $id = sprintf('00000000-0000-4000-8000-%012d', $this->entries);
        $response = $this->send('PUT', "/api/matches/{$id}", ['gameId' => 1, 'firstPersonId' => $first, 'secondPersonId' => $second, 'outcome' => $outcome], $session);
        self::assertSame(201, $response->getStatusCode(), (string) $response->getBody());

        return $id;
    }

    private function verify(string $entry, string $session): void
    {
        $response = $this->send('PUT', "/api/entries/{$entry}/verification", [], $session);
        self::assertSame(204, $response->getStatusCode(), (string) $response->getBody());
    }

    private function pending(string $session, ?string $cursor = null): ResponseInterface
    {
        $response = $this->send('GET', '/api/pending' . ($cursor === null ? '' : '?cursor=' . rawurlencode($cursor)), session: $session);
        self::assertSame(200, $response->getStatusCode(), (string) $response->getBody());

        return $response;
    }

    /**
     * @param array<string, mixed> $queue
     *
     * @return list<mixed>
     */
    private function idsIn(array $queue): array
    {
        self::assertIsList($queue['items']);

        return array_column($queue['items'], 'id');
    }
}
