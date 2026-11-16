<?php

declare(strict_types=1);

namespace Performance\Tests\Integration;

use Performance\Tests\Support\DatabaseTestCase;
use PHPUnit\Framework\Attributes\DataProvider;
use Psr\Http\Message\ResponseInterface;

/**
 * Two writes that lock the same entry from different ends, each in its own process, forced into
 * the interleaving that deadlocked: the test holds the entry, the first write starts and waits
 * for it holding its own row, the second starts and waits behind it, then the test lets go.
 * The order is the same on every run; nothing depends on timing.
 */
final class ConcurrentDeletionTest extends DatabaseTestCase
{
    private const ENTRY = '6f1c2d3e-4a5b-4c6d-8e7f-90a1b2c3d4e5';
    private const SUCCEEDED = 0;
    private const NOT_FOUND = 3;

    private string $admin;
    /** @var array{person: int, drink: int, factor: int} */
    private array $parents;

    protected function setUp(): void
    {
        parent::setUp();
        $this->admin = $this->signIn();
        $this->parents = [
            'person' => $this->createdId($this->send('POST', '/api/persons', ['name' => 'Daniel'], $this->admin)),
            'drink' => $this->createdId($this->send('POST', '/api/drinks', ['name' => 'Bier', 'points' => 1.5], $this->admin)),
            'factor' => $this->createdId($this->send('POST', '/api/factors', ['name' => 'Happy Hour', 'multiplier' => 2], $this->admin)),
        ];
        $entry = ['personId' => $this->parents['person'], 'drinkId' => $this->parents['drink'], 'quantity' => 1, 'factorId' => $this->parents['factor']];
        $response = $this->send('PUT', '/api/entries/' . self::ENTRY, $entry, $this->admin);
        self::assertSame(201, $response->getStatusCode(), (string) $response->getBody());
    }

    /**
     * @return iterable<string, array{'person'|'drink'|'factor', 'person'|'drink'|'factor', list<array{string, string|null}>}>
     */
    public static function competingDeletions(): iterable
    {
        yield 'person, then drink' => ['person', 'drink', [['delete', 'person']]];
        yield 'person, then factor' => ['person', 'factor', [['delete', 'person']]];
        yield 'drink, then factor' => ['drink', 'factor', [['delete', 'drink']]];
        yield 'factor, then drink' => ['factor', 'drink', [['update', 'factor'], ['delete', 'drink']]];
    }

    /**
     * Two admins delete two of the entry's person, drink and factor at the same moment. Both
     * deletions succeed, one after the other, without a deadlock (not even one a retry hides),
     * and the entry's events say what each did to it.
     *
     * @param 'person'|'drink'|'factor'          $first
     * @param 'person'|'drink'|'factor'          $second
     * @param list<array{string, string|null}> $entryEvents each event of the entry, oldest first: its operation and the kind of its cause
     */
    #[DataProvider('competingDeletions')]
    public function testTwoDeletionsOfRowsThatShareAnEntryBothSucceedWithoutADeadlock(string $first, string $second, array $entryEvents): void
    {
        $deadlocks = $this->deadlocks();

        $exitCodes = $this->interleave(["delete-{$first}", (string) $this->parents[$first]], ["delete-{$second}", (string) $this->parents[$second]]);

        self::assertSame([self::SUCCEEDED, self::SUCCEEDED], $exitCodes);
        self::assertSame($deadlocks, $this->deadlocks(), 'no deadlock');
        self::assertSame([[$first, 'delete'], [$second, 'delete']], $this->parentEvents());
        self::assertSame($entryEvents, $this->entryEvents());
        self::assertSame([], $this->rows('SELECT id FROM entries'));
    }

    /**
     * @return iterable<string, array{'person'|'drink'|'factor'}>
     */
    public static function deletionsRacingAnUndo(): iterable
    {
        yield 'person' => ['person'];
        yield 'drink' => ['drink'];
        yield 'factor' => ['factor'];
    }

    /**
     * Someone undoes the entry while an admin deletes its person, drink or factor. The undo
     * locks the entry before the row, the deletion the row before the entry, so they can
     * deadlock; the loser runs again and both requests answer as if they had run one after
     * the other: the deletion succeeds, the undo succeeds or finds the entry gone, and the
     * entry's removal is recorded exactly once.
     *
     * @param 'person'|'drink'|'factor' $kind
     */
    #[DataProvider('deletionsRacingAnUndo')]
    public function testAnEntryUndoRacingADeletionOfItsPersonDrinkOrFactorEndsAsIfTheyRanInTurn(string $kind): void
    {
        [$undo, $deletion] = $this->interleave(['undo-entry', self::ENTRY], ["delete-{$kind}", (string) $this->parents[$kind]]);

        self::assertSame(self::SUCCEEDED, $deletion);
        self::assertContains($undo, [self::SUCCEEDED, self::NOT_FOUND]);
        self::assertSame([[$kind, 'delete']], $this->parentEvents());
        $removals = array_values(array_filter($this->entryEvents(), static fn(array $event): bool => $event[0] === 'delete'));
        self::assertSame([['delete', $undo === self::SUCCEEDED ? null : $kind]], $removals, 'removed once, by whichever ran first');
        self::assertSame([], $this->rows('SELECT id FROM entries'));
    }

    /**
     * Holds the entry under a shared lock, starts the first write and waits until it waits for
     * the entry, then the second and waits until it waits too, then lets go of the entry.
     *
     * @param array{string, string} $first  role and id, as concurrent-write.php takes them
     * @param array{string, string} $second
     *
     * @return array{int, int} the exit codes of both
     */
    private function interleave(array $first, array $second): array
    {
        $holder = $this->otherSession();
        $holder->beginTransaction();
        $holder->prepare('SELECT id FROM entries WHERE id = ? LOCK IN SHARE MODE')->execute([self::ENTRY]);
        $firstProcess = $this->start(...$first);
        $this->waitUntilStatementsWait(1);
        $secondProcess = $this->start(...$second);
        $this->waitUntilStatementsWait(2);
        $holder->commit();

        return [$this->exitCode(...$firstProcess), $this->exitCode(...$secondProcess)];
    }

    /**
     * @return array{resource, array<int, resource>}
     */
    private function start(string $role, string $id): array
    {
        $process = proc_open(
            [PHP_BINARY, __DIR__ . '/../Support/concurrent-write.php', $role, $id, '1'],
            [1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
            $pipes,
        );
        self::assertIsResource($process);

        return [$process, $pipes];
    }

    /**
     * Waits until `$count` statements on the test database have been running for a while: here,
     * where every statement is quick, those wait for a lock (a row's or the deletion lock).
     */
    private function waitUntilStatementsWait(int $count): void
    {
        $observer = $this->otherSession();
        $deadline = microtime(true) + 10.0;
        while (microtime(true) < $deadline) {
            $waiting = $observer->query(
                "SELECT COUNT(*) FROM information_schema.PROCESSLIST
                  WHERE DB = DATABASE() AND ID <> CONNECTION_ID() AND COMMAND IN ('Query', 'Execute') AND TIME_MS >= 300",
            );
            self::assertNotFalse($waiting);
            if ((int) $waiting->fetchColumn() >= $count) {
                return;
            }
            usleep(100_000);
        }
        self::fail("{$count} writes never waited at the same time");
    }

    /**
     * @param resource             $process
     * @param array<int, resource> $pipes
     */
    private function exitCode($process, array $pipes): int
    {
        $output = stream_get_contents($pipes[1]) . stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        $exitCode = proc_close($process);
        self::assertContains($exitCode, [self::SUCCEEDED, self::NOT_FOUND], (string) $output);

        return $exitCode;
    }

    /** How many deadlocks the server has resolved since it started. */
    private function deadlocks(): int
    {
        $status = $this->otherSession()->query("SHOW GLOBAL STATUS LIKE 'Innodb_deadlocks'");
        self::assertNotFalse($status);

        return (int) $status->fetchColumn(1);
    }

    /**
     * The person, drink and factor events after the setup's creates, oldest first.
     *
     * @return list<array{string, string}> subject kind and operation
     */
    private function parentEvents(): array
    {
        $events = [];
        foreach ($this->rows("SELECT subject_kind, operation FROM audit_events WHERE subject_kind <> 'entry' AND operation <> 'create' ORDER BY id") as $row) {
            self::assertIsString($row['subject_kind']);
            self::assertIsString($row['operation']);
            $events[] = [$row['subject_kind'], $row['operation']];
        }

        return $events;
    }

    /**
     * The entry's events after its create, oldest first.
     *
     * @return list<array{string, string|null}> operation and the kind of the causing event, null without one
     */
    private function entryEvents(): array
    {
        $events = [];
        $rows = $this->rows(
            "SELECT e.operation, COALESCE(c.subject_kind, '') AS cause_kind
               FROM audit_events e LEFT JOIN audit_events c ON c.id = e.cause_id
              WHERE e.subject_kind = 'entry' AND e.subject_id = '" . self::ENTRY . "' AND e.operation <> 'create' ORDER BY e.id",
        );
        foreach ($rows as $row) {
            self::assertIsString($row['operation']);
            self::assertIsString($row['cause_kind']);
            $events[] = [$row['operation'], $row['cause_kind'] === '' ? null : $row['cause_kind']];
        }

        return $events;
    }

    private function createdId(ResponseInterface $response): int
    {
        self::assertSame(201, $response->getStatusCode(), (string) $response->getBody());
        $id = $this->body($response)['id'];
        self::assertIsInt($id);

        return $id;
    }
}
