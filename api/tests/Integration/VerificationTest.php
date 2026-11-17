<?php

declare(strict_types=1);

namespace Performance\Tests\Integration;

use Performance\Tests\Support\DatabaseTestCase;
use Psr\Http\Message\ResponseInterface;

/**
 * The four-eyes rule through the API (PRD #61): an account other than the recorder verifies a
 * pending entry, and it counts.
 */
final class VerificationTest extends DatabaseTestCase
{
    private const ANNA_PASSWORD = 'annas-startpasswort';

    /** The bootstrap admin's session; it records the entries. */
    private string $recorder;
    /** Anna's session: another account, which may verify them. */
    private string $anna;
    private int $entries = 0;

    protected function setUp(): void
    {
        parent::setUp();
        $this->recorder = $this->signIn();
        $this->createAccount('anna', self::ANNA_PASSWORD);
        $this->anna = $this->signIn('anna', self::ANNA_PASSWORD);
        $this->send('POST', '/api/persons', ['name' => 'Daniel'], $this->recorder);
        $this->send('POST', '/api/drinks', ['name' => 'Bier', 'points' => 1], $this->recorder);
    }

    public function testAnotherAccountVerifiesAPendingEntryAndItCounts(): void
    {
        $entry = $this->record(quantity: 2);

        $response = $this->verify($entry, $this->anna);

        self::assertSame(204, $response->getStatusCode(), (string) $response->getBody());
        self::assertSame([['name' => 'Daniel', 'score' => 2, 'count' => 2, 'pendingCount' => 0]], $this->ranked());
    }

    public function testTheRecordingAccountCannotVerifyItsOwnEntry(): void
    {
        $entry = $this->record();

        $response = $this->verify($entry, $this->recorder);

        self::assertSame(403, $response->getStatusCode());
        self::assertSame('urn:performance:problem:own-row', $this->body($response)['type']);
        self::assertSame([], $this->ranked(), 'the entry still waits');
        self::assertSame(['Daniel'], $this->unranked());
    }

    public function testAnEntryWhoseRecordingAccountWasDeletedMayBeVerifiedByAnyAccount(): void
    {
        $entry = $this->record(session: $this->anna);
        self::assertSame(204, $this->send('DELETE', '/api/accounts/2', session: $this->recorder)->getStatusCode());

        $response = $this->verify($entry, $this->recorder);

        self::assertSame(204, $response->getStatusCode(), (string) $response->getBody());
        self::assertSame([['name' => 'Daniel', 'score' => 1, 'count' => 1, 'pendingCount' => 0]], $this->ranked($this->recorder));
    }

    public function testAVerifiedEntryKeepsCountingAfterTheVerifyingAccountIsDeleted(): void
    {
        $entry = $this->record();
        $this->verify($entry, $this->anna);

        self::assertSame(204, $this->send('DELETE', '/api/accounts/2', session: $this->recorder)->getStatusCode());

        self::assertSame([['name' => 'Daniel', 'score' => 1, 'count' => 1, 'pendingCount' => 0]], $this->ranked($this->recorder));
    }

    public function testVerifyingAnEntryThatDoesNotExistIs404(): void
    {
        $response = $this->verify('00000000-0000-4000-8000-000000000999', $this->anna);

        self::assertSame(404, $response->getStatusCode());
        self::assertSame('urn:performance:problem:not-found', $this->body($response)['type']);
    }

    public function testAVerificationIsRecordedWithTheVerifyingAccountAndTheEntryBeforeAndAfter(): void
    {
        $entry = $this->record(quantity: 2);

        $this->verify($entry, $this->anna);

        $events = $this->body($this->send('GET', '/api/audit?limit=1', session: $this->recorder))['events'];
        self::assertIsList($events);
        self::assertIsArray($events[0]);
        $entrySnapshot = ['person' => 'Daniel', 'drink' => 'Bier', 'points' => 1, 'quantity' => 2, 'factor' => null];
        self::assertSame(
            [
                'operation' => 'verify',
                'subjectKind' => 'entry',
                'subjectId' => $entry,
                'actor' => ['accountId' => 2, 'userName' => 'anna'],
                'before' => [...$entrySnapshot, 'pending' => true],
                'after' => [...$entrySnapshot, 'pending' => false],
                'cause' => null,
            ],
            array_diff_key($events[0], ['id' => 0, 'occurredAt' => 0]),
        );
    }

    public function testVerifyingAnEntryThatCountsAlreadySucceedsAndChangesNothing(): void
    {
        $entry = $this->record();
        $this->verify($entry, $this->anna);
        $revision = $this->revision();

        $response = $this->verify($entry, $this->anna);

        self::assertSame(204, $response->getStatusCode(), (string) $response->getBody());
        self::assertSame($revision, $this->revision(), 'the revision stays');
        self::assertSame(['create', 'verify'], $this->operationsOn($entry));
    }

    public function testAnotherAccountRejectsAPendingEntryAndItIsGoneWithOneRejectEvent(): void
    {
        $entry = $this->record(quantity: 2);

        $response = $this->reject($entry, $this->anna);

        self::assertSame(204, $response->getStatusCode(), (string) $response->getBody());
        self::assertSame([], $this->ranked());
        self::assertSame([], $this->unranked(), 'nothing of Daniel waits any more');
        self::assertSame([], $this->history(), 'the entry is gone');
        $events = $this->body($this->send('GET', '/api/audit?limit=1', session: $this->recorder))['events'];
        self::assertIsList($events);
        self::assertIsArray($events[0]);
        self::assertSame(
            [
                'operation' => 'reject',
                'subjectKind' => 'entry',
                'subjectId' => $entry,
                'actor' => ['accountId' => 2, 'userName' => 'anna'],
                'before' => ['person' => 'Daniel', 'drink' => 'Bier', 'points' => 1, 'quantity' => 2, 'factor' => null, 'pending' => true],
                'after' => null,
                'cause' => null,
            ],
            array_diff_key($events[0], ['id' => 0, 'occurredAt' => 0]),
        );
        self::assertSame(['create', 'reject'], $this->operationsOn($entry), 'exactly one reject and no delete');
    }

    public function testTheRecordingAccountCannotRejectItsOwnEntry(): void
    {
        $entry = $this->record();

        $response = $this->reject($entry, $this->recorder);

        self::assertSame(403, $response->getStatusCode());
        self::assertSame('urn:performance:problem:own-row', $this->body($response)['type']);
        self::assertSame(['Daniel'], $this->unranked(), 'the entry still waits');
        self::assertSame(['create'], $this->operationsOn($entry));
    }

    public function testRejectingAnEntryThatCountsAlreadyIs409AndChangesNothing(): void
    {
        $entry = $this->record();
        $this->verify($entry, $this->anna);
        $revision = $this->revision();

        $response = $this->reject($entry, $this->anna);

        self::assertSame(409, $response->getStatusCode());
        self::assertSame('urn:performance:problem:already-verified', $this->body($response)['type']);
        self::assertSame([['name' => 'Daniel', 'score' => 1, 'count' => 1, 'pendingCount' => 0]], $this->ranked());
        self::assertSame($revision, $this->revision(), 'the revision stays');
        self::assertSame(['create', 'verify'], $this->operationsOn($entry));
    }

    public function testRejectingAnEntryThatDoesNotExistIs404(): void
    {
        $response = $this->reject('00000000-0000-4000-8000-000000000999', $this->anna);

        self::assertSame(404, $response->getStatusCode());
        self::assertSame('urn:performance:problem:not-found', $this->body($response)['type']);
    }

    public function testAnEntryWhoseRecordingAccountWasDeletedMayBeRejectedByAnyAccount(): void
    {
        $entry = $this->record(session: $this->anna);
        self::assertSame(204, $this->send('DELETE', '/api/accounts/2', session: $this->recorder)->getStatusCode());

        $response = $this->reject($entry, $this->recorder);

        self::assertSame(204, $response->getStatusCode(), (string) $response->getBody());
        self::assertSame([], $this->history($this->recorder));
    }

    public function testADeletionThroughTheEntryRouteStaysADeleteEvenForAPendingEntry(): void
    {
        $entry = $this->record();

        self::assertSame(204, $this->send('DELETE', "/api/entries/{$entry}", session: $this->anna)->getStatusCode());

        self::assertSame(['create', 'delete'], $this->operationsOn($entry));
    }

    private function reject(string $entry, string $session): ResponseInterface
    {
        return $this->send('DELETE', "/api/entries/{$entry}/verification", session: $session);
    }

    /**
     * The ids of Daniel's entries today, as his Verlauf lists them.
     *
     * @return list<mixed>
     */
    private function history(?string $session = null): array
    {
        $entries = $this->body($this->send('GET', '/api/entries?personId=1&from=2026-11-14T00:00:00.000Z', session: $session ?? $this->anna))['entries'];
        self::assertIsList($entries);

        return array_column($entries, 'id');
    }

    private function verify(string $entry, string $session): ResponseInterface
    {
        // A PUT carries a JSON body; verifying needs none, so the client sends an empty object.
        return $this->send('PUT', "/api/entries/{$entry}/verification", [], $session);
    }

    /** Records an entry for Daniel as the bootstrap admin; it waits for verification. */
    private function record(int $quantity = 1, ?string $session = null): string
    {
        ++$this->entries;
        $id = sprintf('00000000-0000-4000-8000-%012d', $this->entries);
        $response = $this->send('PUT', "/api/entries/{$id}", ['personId' => 1, 'drinkId' => 1, 'quantity' => $quantity], $session ?? $this->recorder);
        self::assertSame(201, $response->getStatusCode(), (string) $response->getBody());

        return $id;
    }

    /** The data revision, as the scoreboard's ETag names it. */
    private function revision(): string
    {
        return $this->send('GET', '/api/scoreboard?from=2026-11-14T00:00:00.000Z', session: $this->anna)->getHeaderLine('ETag');
    }

    /**
     * The operations the audit log recorded on an entry, oldest first.
     *
     * @return list<mixed>
     */
    private function operationsOn(string $entry): array
    {
        $events = $this->body($this->send('GET', '/api/audit', session: $this->recorder))['events'];
        self::assertIsList($events);
        $operations = [];
        foreach (array_reverse($events) as $event) {
            self::assertIsArray($event);
            if ($event['subjectId'] === $entry) {
                $operations[] = $event['operation'];
            }
        }

        return $operations;
    }

    /**
     * The names of today's persons without a rank: their entries all wait.
     *
     * @return list<mixed>
     */
    private function unranked(): array
    {
        $unranked = $this->body($this->send('GET', '/api/scoreboard?from=2026-11-14T00:00:00.000Z', session: $this->anna))['unranked'];
        self::assertIsList($unranked);

        return array_column($unranked, 'name');
    }

    /**
     * Today's ranked persons as the Rangliste shows them.
     *
     * @return list<array{name: mixed, score: mixed, count: mixed, pendingCount: mixed}>
     */
    private function ranked(?string $session = null): array
    {
        $rows = $this->body($this->send('GET', '/api/scoreboard?from=2026-11-14T00:00:00.000Z', session: $session ?? $this->anna))['rows'];
        self::assertIsList($rows);

        return array_map(
            static function (mixed $row): array {
                self::assertIsArray($row);

                return ['name' => $row['name'], 'score' => $row['score'], 'count' => $row['count'], 'pendingCount' => $row['pendingCount']];
            },
            $rows,
        );
    }
}
