<?php

declare(strict_types=1);

namespace Performance\Tests\Integration;

use Performance\Tests\Support\DatabaseTestCase;
use Psr\Http\Message\ResponseInterface;

/**
 * The four-eyes rule for points results through the API (PRD #61): a recorded result waits
 * and stays out of the standings; once an account other than the recorder verifies it, it
 * counts. A person whose results in the run all wait has no rank and never leads, in either
 * ranking direction and whatever the others' totals are. The answers are the ones entries give.
 */
final class ResultVerificationTest extends DatabaseTestCase
{
    private const ANNA_PASSWORD = 'annas-startpasswort';

    /** The bootstrap admin's session; it records the results. */
    private string $recorder;
    /** Anna's session: another account, which may verify them. */
    private string $anna;
    private int $results = 0;

    protected function setUp(): void
    {
        parent::setUp();
        $this->recorder = $this->signIn();
        $this->createAccount('anna', self::ANNA_PASSWORD);
        $this->anna = $this->signIn('anna', self::ANNA_PASSWORD);
        foreach (['Daniel', 'Erik', 'Fritz'] as $name) {
            $this->send('POST', '/api/persons', ['name' => $name], $this->recorder);
        }
        $this->send('POST', '/api/games', ['name' => 'Wizard', 'kind' => 'points'], $this->recorder);
    }

    public function testARecordedResultStaysOutOfTheStandingsAndItsPersonWaitsUnranked(): void
    {
        $this->record(1, 30);

        $standings = $this->standings();

        self::assertSame([], $standings['rows']);
        self::assertSame([['personId' => 1, 'name' => 'Daniel', 'pendingCount' => 1]], $standings['unranked']);
    }

    public function testAnotherAccountVerifiesAPendingResultAndItCounts(): void
    {
        $result = $this->record(1, 30);

        $response = $this->verify($result, $this->anna);

        self::assertSame(204, $response->getStatusCode(), (string) $response->getBody());
        self::assertSame([['Daniel', 30, 1, 0]], $this->ranked());
        self::assertSame([], $this->standings()['unranked']);
    }

    /**
     * Highest wins, every verified total negative: a person with pending results only would
     * lead on a total of zero, so they are listed apart; a ranked person's pending results
     * neither add to their total nor to their count of results, only to their pending count.
     */
    public function testWhenTheHighestWinsAPersonWithPendingResultsOnlyIsUnrankedAndNeverLeadsNegativeTotals(): void
    {
        $this->verify($this->record(1, -5), $this->anna);
        $this->verify($this->record(2, -2), $this->anna);
        $this->record(2, -40);
        $this->record(3, 0);
        $this->record(3, 25);

        $standings = $this->standings();

        self::assertSame([['Erik', -2, 1, 1], ['Daniel', -5, 1, 0]], $this->ranked());
        self::assertSame([['personId' => 3, 'name' => 'Fritz', 'pendingCount' => 2]], $standings['unranked']);
    }

    /**
     * Lowest wins: a person whose only result is a pending zero would lead a ladder of
     * positive totals and beat a negative one if counted as zero; they are listed apart.
     */
    public function testWhenTheLowestWinsAPersonWithAPendingZeroOnlyIsUnrankedAndNeverLeads(): void
    {
        $this->send('PATCH', '/api/games/1', ['name' => 'Wizard', 'lowerWins' => true], $this->recorder);
        $this->verify($this->record(1, 12), $this->anna);
        $this->verify($this->record(2, -3), $this->anna);
        $this->record(2, 50);
        $this->record(3, 0);

        $standings = $this->standings();

        self::assertTrue($standings['lowerWins']);
        self::assertSame([['Erik', -3, 1, 1], ['Daniel', 12, 1, 0]], $this->ranked());
        self::assertSame([['personId' => 3, 'name' => 'Fritz', 'pendingCount' => 1]], $standings['unranked']);
    }

    public function testVerifyingAResultOfAnEarlierRunLeavesTheCurrentStandingsUnchanged(): void
    {
        $earlier = $this->record(1, 30);
        $this->send('POST', '/api/games/1/restart', [], $this->recorder);
        $this->verify($this->record(2, 10), $this->anna);
        $before = $this->standings();

        $response = $this->verify($earlier, $this->anna);

        self::assertSame(204, $response->getStatusCode(), (string) $response->getBody());
        self::assertSame($before, $this->standings());
    }

    public function testTheGamesVerlaufMarksEachResultPendingOrNot(): void
    {
        $verified = $this->record(1, 30);
        $this->verify($verified, $this->anna);
        $pending = $this->record(2, -4);

        $items = $this->body($this->send('GET', '/api/games/1/results', session: $this->anna))['items'];

        self::assertIsList($items);
        self::assertSame(
            [[$pending, true], [$verified, false]],
            array_map(static fn(mixed $item): array => is_array($item) ? [$item['id'], $item['pending']] : [], $items),
        );
    }

    public function testTheRecordingAccountCannotVerifyItsOwnResult(): void
    {
        $result = $this->record(1, 30);

        $response = $this->verify($result, $this->recorder);

        self::assertSame(403, $response->getStatusCode());
        self::assertSame('urn:performance:problem:own-row', $this->body($response)['type']);
        self::assertSame([], $this->ranked(), 'the result still waits');
    }

    public function testVerifyingAResultThatCountsAlreadySucceedsAndChangesNothing(): void
    {
        $result = $this->record(1, 30);
        $this->verify($result, $this->anna);
        $revision = $this->revision();

        $response = $this->verify($result, $this->anna);

        self::assertSame(204, $response->getStatusCode(), (string) $response->getBody());
        self::assertSame($revision, $this->revision(), 'the revision stays');
        self::assertSame(['create', 'verify'], $this->operationsOn($result));
    }

    public function testAVerificationIsRecordedWithTheVerifyingAccountAndTheResultBeforeAndAfter(): void
    {
        $result = $this->record(2, -7);

        $this->verify($result, $this->anna);

        $events = $this->body($this->send('GET', '/api/audit?limit=1', session: $this->recorder))['events'];
        self::assertIsList($events);
        self::assertIsArray($events[0]);
        $snapshot = ['game' => 'Wizard', 'person' => 'Erik', 'points' => -7];
        self::assertSame(
            [
                'operation' => 'verify',
                'subjectKind' => 'result',
                'subjectId' => $result,
                'actor' => ['accountId' => 2, 'userName' => 'anna'],
                'before' => [...$snapshot, 'pending' => true],
                'after' => [...$snapshot, 'pending' => false],
                'cause' => null,
            ],
            array_diff_key($events[0], ['id' => 0, 'occurredAt' => 0]),
        );
    }

    public function testAnotherAccountRejectsAPendingResultAndItIsGoneWithOneRejectEvent(): void
    {
        $result = $this->record(1, 30);

        $response = $this->reject($result, $this->anna);

        self::assertSame(204, $response->getStatusCode(), (string) $response->getBody());
        self::assertSame(['rows' => [], 'unranked' => []], array_intersect_key($this->standings(), ['rows' => 0, 'unranked' => 0]));
        self::assertSame([], $this->body($this->send('GET', '/api/games/1/results', session: $this->anna))['items']);
        self::assertSame(['create', 'reject'], $this->operationsOn($result), 'exactly one reject and no delete');
    }

    public function testTheRecordingAccountCannotRejectItsOwnResult(): void
    {
        $result = $this->record(1, 30);

        $response = $this->reject($result, $this->recorder);

        self::assertSame(403, $response->getStatusCode());
        self::assertSame('urn:performance:problem:own-row', $this->body($response)['type']);
        self::assertSame(['create'], $this->operationsOn($result));
    }

    public function testRejectingAResultThatCountsAlreadyIs409AndChangesNothing(): void
    {
        $result = $this->record(1, 30);
        $this->verify($result, $this->anna);
        $revision = $this->revision();

        $response = $this->reject($result, $this->anna);

        self::assertSame(409, $response->getStatusCode());
        self::assertSame('urn:performance:problem:already-verified', $this->body($response)['type']);
        self::assertSame([['Daniel', 30, 1, 0]], $this->ranked());
        self::assertSame($revision, $this->revision(), 'the revision stays');
    }

    public function testVerifyingOrRejectingAResultThatDoesNotExistIs404(): void
    {
        foreach ([$this->verify('00000000-0000-4000-8000-000000000999', $this->anna), $this->reject('00000000-0000-4000-8000-000000000999', $this->anna)] as $response) {
            self::assertSame(404, $response->getStatusCode());
            self::assertSame('urn:performance:problem:not-found', $this->body($response)['type']);
        }
    }

    public function testAResultWhoseRecordingAccountWasDeletedMayBeVerifiedByAnyAccount(): void
    {
        $result = $this->record(1, 30, $this->anna);
        self::assertSame(204, $this->send('DELETE', '/api/accounts/2', session: $this->recorder)->getStatusCode());

        $response = $this->verify($result, $this->recorder);

        self::assertSame(204, $response->getStatusCode(), (string) $response->getBody());
        self::assertSame([['Daniel', 30, 1, 0]], $this->ranked($this->recorder));
    }

    public function testAnUndoThroughTheResultRouteStaysADeleteEvenForAPendingResult(): void
    {
        $result = $this->record(1, 30);

        self::assertSame(204, $this->send('DELETE', "/api/results/{$result}", session: $this->anna)->getStatusCode());

        self::assertSame(['create', 'delete'], $this->operationsOn($result));
    }

    /** Records a result in Wizard, which waits for verification. */
    private function record(int $person, int $points, ?string $session = null): string
    {
        ++$this->results;
        $id = sprintf('00000000-0000-4000-8000-%012d', $this->results);
        $response = $this->send('PUT', "/api/results/{$id}", ['gameId' => 1, 'personId' => $person, 'points' => $points], $session ?? $this->recorder);
        self::assertSame(201, $response->getStatusCode(), (string) $response->getBody());

        return $id;
    }

    private function verify(string $result, string $session): ResponseInterface
    {
        return $this->send('PUT', "/api/results/{$result}/verification", [], $session);
    }

    private function reject(string $result, string $session): ResponseInterface
    {
        return $this->send('DELETE', "/api/results/{$result}/verification", session: $session);
    }

    /**
     * @return array<string, mixed>
     */
    private function standings(?string $session = null): array
    {
        return $this->body($this->send('GET', '/api/games/1/standings', session: $session ?? $this->anna));
    }

    /**
     * Wizard's ranked persons as name, sum, results and pending results.
     *
     * @return list<array{mixed, mixed, mixed, mixed}>
     */
    private function ranked(?string $session = null): array
    {
        $rows = $this->standings($session)['rows'];
        self::assertIsList($rows);

        return array_map(static function (mixed $row): array {
            self::assertIsArray($row);

            return [$row['name'], $row['sum'], $row['results'], $row['pendingCount']];
        }, $rows);
    }

    /** The data revision, as the standings' ETag names it. */
    private function revision(): string
    {
        return $this->send('GET', '/api/games/1/standings', session: $this->anna)->getHeaderLine('ETag');
    }

    /**
     * The operations the audit log recorded on a result, oldest first.
     *
     * @return list<mixed>
     */
    private function operationsOn(string $result): array
    {
        $events = $this->body($this->send('GET', '/api/audit?limit=100', session: $this->recorder))['events'];
        self::assertIsList($events);
        $operations = [];
        foreach (array_reverse($events) as $event) {
            self::assertIsArray($event);
            if ($event['subjectId'] === $result) {
                $operations[] = $event['operation'];
            }
        }

        return $operations;
    }
}
