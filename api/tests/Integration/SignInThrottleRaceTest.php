<?php

declare(strict_types=1);

namespace Performance\Tests\Integration;

use Performance\Domain\Sessions;
use Performance\Tests\Support\DatabaseTestCase;

/**
 * Many wrong-password sign-ins for one user name and address at the same instant:
 * the database bounds them, so no more passwords are checked than the throttle allows.
 */
final class SignInThrottleRaceTest extends DatabaseTestCase
{
    private const PROCESSES = 16;
    private const ROUNDS = 3;
    private const CHECKED = 0;
    private const REFUSED = 3;

    public function testParallelWrongPasswordsCheckNoMoreThanTheThrottleAllows(): void
    {
        $this->get('/api/health');
        $this->signIn();
        for ($round = 1; $round <= self::ROUNDS; ++$round) {
            $address = "203.0.113.{$round}";

            $exitCodes = $this->race(self::ADMIN, $address);

            $checked = count(array_filter($exitCodes, static fn(int $code): bool => $code === self::CHECKED));
            self::assertLessThanOrEqual(Sessions::MAX_FAILURES, $checked, "round {$round}: passwords checked");
            self::assertCount(
                $checked,
                $this->rows("SELECT id FROM login_attempts WHERE client_address = '{$address}'"),
                "round {$round}: every checked password is a recorded failure, a refused attempt leaves none",
            );
        }
    }

    /**
     * Starts the sign-ins in separate processes at the same instant.
     *
     * @return list<int> the exit codes
     */
    private function race(string $userName, string $address): array
    {
        $script = __DIR__ . '/../Support/sign-in-race.php';
        $startAt = microtime(true) + 1.0;
        $processes = [];
        for ($i = 0; $i < self::PROCESSES; ++$i) {
            $process = proc_open(
                [PHP_BINARY, $script, (string) $startAt, $userName, $address],
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
            self::assertContains($exitCode, [self::CHECKED, self::REFUSED], (string) $errors);
            $exitCodes[] = $exitCode;
        }

        return $exitCodes;
    }
}
