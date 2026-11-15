<?php

declare(strict_types=1);

namespace Performance\Tests\Integration;

use Performance\Tests\Support\DatabaseTestCase;
use PHPUnit\Framework\Attributes\DataProvider;

/**
 * Two requests that each remove one of the last two admins at the same instant:
 * the database serialises them, so one succeeds and the other is refused.
 */
final class LastAdminRaceTest extends DatabaseTestCase
{
    private const ROUNDS = 5;
    private const REFUSED = 3;

    /**
     * @return iterable<string, array{string, string}>
     */
    public static function races(): iterable
    {
        yield 'two demotions' => ['demote', 'demote'];
        yield 'two deletions' => ['delete', 'delete'];
        yield 'a demotion and a deletion' => ['demote', 'delete'];
    }

    #[DataProvider('races')]
    public function testParallelRemovalsOfTheLastTwoAdminsLeaveOneAdmin(string $first, string $second): void
    {
        $this->get('/api/health');
        for ($round = 1; $round <= self::ROUNDS; ++$round) {
            [$one, $two] = $this->lastTwoAdmins("round{$round}");

            $exitCodes = $this->race([$first, $one], [$second, $two]);

            sort($exitCodes);
            self::assertSame([0, self::REFUSED], $exitCodes, "round {$round}: one succeeds, one is refused");
            self::assertCount(1, $this->rows('SELECT id FROM accounts WHERE is_admin = 1'), "round {$round}: one admin remains");
        }
    }

    /**
     * Two new accounts that are the only admins.
     *
     * @return array{int, int} their ids
     */
    private function lastTwoAdmins(string $prefix): array
    {
        $pdo = $this->otherSession();
        $pdo->exec('UPDATE accounts SET is_admin = 0');
        $insert = $pdo->prepare(
            "INSERT INTO accounts (user_name, password_hash, is_admin, created_at, updated_at) VALUES (?, 'x', 1, NOW(3), NOW(3))",
        );
        $ids = [];
        foreach (['a', 'b'] as $suffix) {
            $insert->execute([$prefix . $suffix]);
            $ids[] = (int) $pdo->lastInsertId();
        }

        return [$ids[0], $ids[1]];
    }

    /**
     * Starts both changes in separate processes at the same instant.
     *
     * @param array{string, int} ...$changes action and account id
     *
     * @return list<int> the exit codes
     */
    private function race(array ...$changes): array
    {
        $script = __DIR__ . '/../Support/last-admin-race.php';
        $startAt = microtime(true) + 0.5;
        $processes = [];
        foreach ($changes as [$action, $id]) {
            $process = proc_open(
                [PHP_BINARY, $script, (string) $startAt, $action, (string) $id],
                [1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
                $pipes,
            );
            self::assertIsResource($process);
            $processes[] = [$process, $pipes];
        }
        $exitCodes = [];
        foreach ($processes as [$process, $pipes]) {
            $errors = stream_get_contents($pipes[2]);
            fclose($pipes[1]);
            fclose($pipes[2]);
            $exitCode = proc_close($process);
            self::assertContains($exitCode, [0, self::REFUSED], (string) $errors);
            $exitCodes[] = $exitCode;
        }

        return $exitCodes;
    }
}
