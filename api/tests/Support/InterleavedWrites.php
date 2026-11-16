<?php

declare(strict_types=1);

namespace Performance\Tests\Support;

/**
 * Runs writes of concurrent-write.php in a fixed order against one row: the row is held under
 * a shared lock while each write starts and waits for it, then let go. The order is the same
 * on every run; nothing depends on timing. For a DatabaseTestCase.
 */
trait InterleavedWrites
{
    /**
     * Holds the row under a shared lock, starts the first write and waits until it waits, then
     * the next and waits until it waits too, and so on, then lets go of the row.
     *
     * @param 'matches'|'results'|'persons' $table
     * @param string|list<string>           $ids the row held, or the rows held when the writes start on different rows
     * @param list<array{string, string}>  $writes each one's role and id, as concurrent-write.php takes them
     *
     * @return list<int> the exit codes, in the order given: 0 succeeded, 3 found its row gone
     */
    private function interleave(string $table, string|array $ids, array $writes): array
    {
        $holder = $this->otherSession();
        $holder->beginTransaction();
        foreach ((array) $ids as $id) {
            $holder->prepare("SELECT id FROM {$table} WHERE id = ? LOCK IN SHARE MODE")->execute([$id]);
        }
        $started = [];
        foreach ($writes as [$role, $subject]) {
            $process = proc_open(
                [PHP_BINARY, __DIR__ . '/concurrent-write.php', $role, $subject, '1'],
                [1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
                $pipes,
            );
            self::assertIsResource($process);
            $started[] = [$process, $pipes];
            $this->waitUntilStatementsWait(count($started));
        }
        $holder->commit();
        $exitCodes = [];
        foreach ($started as [$process, $pipes]) {
            $exitCodes[] = $this->exitCode($process, $pipes);
        }

        return $exitCodes;
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
        self::assertContains($exitCode, [0, 3], (string) $output);

        return $exitCode;
    }
}
