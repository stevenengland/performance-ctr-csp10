<?php

declare(strict_types=1);

namespace Performance\Tests\Integration;

use Performance\Tests\Support\DatabaseTestCase;
use Psr\Http\Message\ResponseInterface;

/**
 * The four-eyes rule for duel matches through the API (PRD #61): a recorded match waits and
 * counts for neither player; once an account other than the recorder verifies it, it counts on
 * both sides at once. The answers are the ones entries give.
 */
final class MatchVerificationTest extends DatabaseTestCase
{
    private const ANNA_PASSWORD = 'annas-startpasswort';

    /** The bootstrap admin's session; it records the matches. */
    private string $recorder;
    /** Anna's session: another account, which may verify them. */
    private string $anna;
    private int $matches = 0;

    protected function setUp(): void
    {
        parent::setUp();
        $this->recorder = $this->signIn();
        $this->createAccount('anna', self::ANNA_PASSWORD);
        $this->anna = $this->signIn('anna', self::ANNA_PASSWORD);
        foreach (['Daniel', 'Erik', 'Fritz'] as $name) {
            $this->send('POST', '/api/persons', ['name' => $name], $this->recorder);
        }
        $this->send('POST', '/api/games', ['name' => 'Schach', 'kind' => 'duel'], $this->recorder);
    }

    public function testARecordedMatchCountsForNeitherPlayerAndBothWaitUnranked(): void
    {
        $this->record(1, 2, 'first');

        $standings = $this->standings();

        self::assertSame([], $standings['rows']);
        self::assertSame(
            [['personId' => 1, 'name' => 'Daniel', 'pendingCount' => 1], ['personId' => 2, 'name' => 'Erik', 'pendingCount' => 1]],
            $standings['unranked'],
        );
    }

    public function testAnotherAccountVerifiesAPendingMatchAndItCountsOnBothSides(): void
    {
        $match = $this->record(1, 2, 'first');

        $response = $this->verify($match, $this->anna);

        self::assertSame(204, $response->getStatusCode(), (string) $response->getBody());
        self::assertSame([['Daniel', 1, 1, 0], ['Erik', 0, 1, 0]], $this->ranked());
        self::assertSame([], $this->standings()['unranked']);
    }

    /**
     * Each surviving player counts a pending match once; a player with a verified match is
     * ranked and names the pending ones beside it, a player with pending matches only is not
     * ranked and never leads.
     */
    public function testEachPlayerCountsTheirPendingMatchesOnceAndOnlyAPlayerWithAVerifiedOneIsRanked(): void
    {
        $this->verify($this->record(2, 1, 'first'), $this->anna);
        $this->record(1, 3, 'first');
        $this->record(3, 1, 'draw');

        $standings = $this->standings();

        self::assertSame([['Erik', 1, 1, 0], ['Daniel', 0, 1, 2]], $this->ranked());
        self::assertSame([['personId' => 3, 'name' => 'Fritz', 'pendingCount' => 2]], $standings['unranked']);
    }

    public function testAPendingMatchWithAClearedSideKeepsItClearedThroughVerifyAndCountsForTheRemainingPlayerOnly(): void
    {
        $match = $this->record(1, 2, 'second');
        self::assertSame(204, $this->send('DELETE', '/api/persons/1', session: $this->recorder)->getStatusCode());

        $response = $this->verify($match, $this->anna);

        self::assertSame(204, $response->getStatusCode(), (string) $response->getBody());
        self::assertSame([['Erik', 1, 1, 0]], $this->ranked());
        $items = $this->body($this->send('GET', '/api/games/1/matches', session: $this->anna))['items'];
        self::assertIsList($items);
        self::assertIsArray($items[0]);
        self::assertSame([null, ['id' => 2, 'name' => 'Erik'], false], [$items[0]['first'], $items[0]['second'], $items[0]['pending']]);
    }

    public function testVerifyingAMatchOfAnEarlierRunLeavesTheCurrentStandingsUnchanged(): void
    {
        $earlier = $this->record(1, 2, 'first');
        $this->send('POST', '/api/games/1/restart', [], $this->recorder);
        $this->verify($this->record(2, 3, 'draw'), $this->anna);
        $before = $this->standings();

        $response = $this->verify($earlier, $this->anna);

        self::assertSame(204, $response->getStatusCode(), (string) $response->getBody());
        self::assertSame($before, $this->standings());
    }

    public function testTheRecordingAccountCannotVerifyItsOwnMatch(): void
    {
        $match = $this->record(1, 2, 'first');

        $response = $this->verify($match, $this->recorder);

        self::assertSame(403, $response->getStatusCode());
        self::assertSame('urn:performance:problem:own-row', $this->body($response)['type']);
        self::assertSame([], $this->ranked(), 'the match still waits');
    }

    public function testVerifyingAMatchThatCountsAlreadySucceedsAndChangesNothing(): void
    {
        $match = $this->record(1, 2, 'first');
        $this->verify($match, $this->anna);
        $revision = $this->revision();

        $response = $this->verify($match, $this->anna);

        self::assertSame(204, $response->getStatusCode(), (string) $response->getBody());
        self::assertSame($revision, $this->revision(), 'the revision stays');
        self::assertSame(['create', 'verify'], $this->operationsOn($match));
    }

    public function testAVerificationIsRecordedWithTheVerifyingAccountAndTheMatchBeforeAndAfter(): void
    {
        $match = $this->record(1, 2, 'draw');

        $this->verify($match, $this->anna);

        $events = $this->body($this->send('GET', '/api/audit?limit=1', session: $this->recorder))['events'];
        self::assertIsList($events);
        self::assertIsArray($events[0]);
        $snapshot = ['game' => 'Schach', 'first' => 'Daniel', 'second' => 'Erik', 'outcome' => 'draw'];
        self::assertSame(
            [
                'operation' => 'verify',
                'subjectKind' => 'match',
                'subjectId' => $match,
                'actor' => ['accountId' => 2, 'userName' => 'anna'],
                'before' => [...$snapshot, 'pending' => true],
                'after' => [...$snapshot, 'pending' => false],
                'cause' => null,
            ],
            array_diff_key($events[0], ['id' => 0, 'occurredAt' => 0]),
        );
    }

    public function testAnotherAccountRejectsAPendingMatchAndItIsGoneWithOneRejectEvent(): void
    {
        $match = $this->record(1, 2, 'first');

        $response = $this->reject($match, $this->anna);

        self::assertSame(204, $response->getStatusCode(), (string) $response->getBody());
        self::assertSame(['rows' => [], 'unranked' => []], array_intersect_key($this->standings(), ['rows' => 0, 'unranked' => 0]));
        self::assertSame([], $this->body($this->send('GET', '/api/games/1/matches', session: $this->anna))['items']);
        self::assertSame(['create', 'reject'], $this->operationsOn($match), 'exactly one reject and no delete');
    }

    public function testTheRecordingAccountCannotRejectItsOwnMatch(): void
    {
        $match = $this->record(1, 2, 'first');

        $response = $this->reject($match, $this->recorder);

        self::assertSame(403, $response->getStatusCode());
        self::assertSame('urn:performance:problem:own-row', $this->body($response)['type']);
        self::assertSame(['create'], $this->operationsOn($match));
    }

    public function testRejectingAMatchThatCountsAlreadyIs409AndChangesNothing(): void
    {
        $match = $this->record(1, 2, 'first');
        $this->verify($match, $this->anna);
        $revision = $this->revision();

        $response = $this->reject($match, $this->anna);

        self::assertSame(409, $response->getStatusCode());
        self::assertSame('urn:performance:problem:already-verified', $this->body($response)['type']);
        self::assertSame([['Daniel', 1, 1, 0], ['Erik', 0, 1, 0]], $this->ranked());
        self::assertSame($revision, $this->revision(), 'the revision stays');
    }

    public function testVerifyingOrRejectingAMatchThatDoesNotExistIs404(): void
    {
        foreach ([$this->verify('00000000-0000-4000-8000-000000000999', $this->anna), $this->reject('00000000-0000-4000-8000-000000000999', $this->anna)] as $response) {
            self::assertSame(404, $response->getStatusCode());
            self::assertSame('urn:performance:problem:not-found', $this->body($response)['type']);
        }
    }

    public function testAMatchWhoseRecordingAccountWasDeletedMayBeVerifiedByAnyAccount(): void
    {
        $match = $this->record(1, 2, 'first', $this->anna);
        self::assertSame(204, $this->send('DELETE', '/api/accounts/2', session: $this->recorder)->getStatusCode());

        $response = $this->verify($match, $this->recorder);

        self::assertSame(204, $response->getStatusCode(), (string) $response->getBody());
        self::assertSame([['Daniel', 1, 1, 0], ['Erik', 0, 1, 0]], $this->ranked($this->recorder));
    }

    public function testAnUndoThroughTheMatchRouteStaysADeleteEvenForAPendingMatch(): void
    {
        $match = $this->record(1, 2, 'first');

        self::assertSame(204, $this->send('DELETE', "/api/matches/{$match}", session: $this->anna)->getStatusCode());

        self::assertSame(['create', 'delete'], $this->operationsOn($match));
    }

    /** Records a match in Schach, which waits for verification. */
    private function record(int $first, int $second, string $outcome, ?string $session = null): string
    {
        ++$this->matches;
        $id = sprintf('00000000-0000-4000-8000-%012d', $this->matches);
        $response = $this->send('PUT', "/api/matches/{$id}", ['gameId' => 1, 'firstPersonId' => $first, 'secondPersonId' => $second, 'outcome' => $outcome], $session ?? $this->recorder);
        self::assertSame(201, $response->getStatusCode(), (string) $response->getBody());

        return $id;
    }

    private function verify(string $match, string $session): ResponseInterface
    {
        return $this->send('PUT', "/api/matches/{$match}/verification", [], $session);
    }

    private function reject(string $match, string $session): ResponseInterface
    {
        return $this->send('DELETE', "/api/matches/{$match}/verification", session: $session);
    }

    /**
     * @return array<string, mixed>
     */
    private function standings(?string $session = null): array
    {
        return $this->body($this->send('GET', '/api/games/1/standings', session: $session ?? $this->anna));
    }

    /**
     * Schach's ranked persons as name, points, played and pending matches.
     *
     * @return list<array{mixed, mixed, mixed, mixed}>
     */
    private function ranked(?string $session = null): array
    {
        $rows = $this->standings($session)['rows'];
        self::assertIsList($rows);

        return array_map(static function (mixed $row): array {
            self::assertIsArray($row);

            return [$row['name'], $row['points'], $row['played'], $row['pendingCount']];
        }, $rows);
    }

    /** The data revision, as the standings' ETag names it. */
    private function revision(): string
    {
        return $this->send('GET', '/api/games/1/standings', session: $this->anna)->getHeaderLine('ETag');
    }

    /**
     * The operations the audit log recorded on a match, oldest first.
     *
     * @return list<mixed>
     */
    private function operationsOn(string $match): array
    {
        $events = $this->body($this->send('GET', '/api/audit?limit=100', session: $this->recorder))['events'];
        self::assertIsList($events);
        $operations = [];
        foreach (array_reverse($events) as $event) {
            self::assertIsArray($event);
            if ($event['subjectId'] === $match) {
                $operations[] = $event['operation'];
            }
        }

        return $operations;
    }
}
