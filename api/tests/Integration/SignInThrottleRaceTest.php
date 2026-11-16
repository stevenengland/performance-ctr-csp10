<?php

declare(strict_types=1);

namespace Performance\Tests\Integration;

use Performance\Domain\Sessions;
use Performance\Tests\Support\DatabaseTestCase;
use Psr\Http\Message\ResponseInterface;

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
    private const DANIEL = 'daniels-passwort';

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
     * A wrong password is still being checked when a sign-in with the right one succeeds for
     * the same user name and address. The success forgets only failures that had finished:
     * the one in flight is recorded when it fails, and counts toward the throttle.
     *
     * The order is forced, not left to chance: the wrong attempt checks a hash of cost 15
     * (seconds), and once it has reserved its attempt the test swaps in a hash of cost 4 for
     * the same password, so the right attempt takes milliseconds. The test checks that the
     * wrong attempt was still running when the right one finished, so a slow machine fails
     * the test instead of passing it without the interleaving.
     */
    public function testASuccessfulSignInDoesNotForgetAFailureThatIsStillBeingChecked(): void
    {
        $this->get('/api/health');
        $this->createAccount('daniel', self::DANIEL);
        $this->setDanielsHash(password_hash(self::DANIEL, PASSWORD_BCRYPT, ['cost' => 15]));
        $address = '203.0.113.99';

        $wrong = $this->startSignIn('daniel', $address, microtime(true));
        $this->waitForAttempts($address, 1);
        // The wrong attempt read the slow hash right after reserving; give it a moment to start bcrypt.
        usleep(200_000);
        $this->setDanielsHash(password_hash(self::DANIEL, PASSWORD_BCRYPT, ['cost' => 4]));
        self::assertSame(200, $this->attempt($address)->getStatusCode(), 'the right password signs in');
        self::assertTrue(proc_get_status($wrong[0])['running'], 'the wrong attempt was still being checked');

        self::assertSame(self::CHECKED, $this->exitCode(...$wrong));
        self::assertCount(1, $this->rows("SELECT id FROM login_attempts WHERE client_address = '{$address}'"));
        self::assertCount(
            1,
            $this->rows("SELECT id FROM login_attempts WHERE client_address = '{$address}' AND pending = 0"),
            'the failure that finished after the success is recorded',
        );
        for ($failure = 2; $failure <= Sessions::MAX_FAILURES; ++$failure) {
            self::assertSame(401, $this->attempt($address, 'falsches-passwort')->getStatusCode());
        }
        self::assertSame(429, $this->attempt($address)->getStatusCode(), 'and it counts toward the throttle');
    }

    /**
     * Starts the sign-ins in separate processes at the same instant.
     *
     * @return list<int> the exit codes
     */
    private function race(string $userName, string $address): array
    {
        $startAt = microtime(true) + 1.0;
        $processes = [];
        for ($i = 0; $i < self::PROCESSES; ++$i) {
            $processes[] = $this->startSignIn($userName, $address, $startAt);
        }

        return array_map(fn(array $process): int => $this->exitCode(...$process), $processes);
    }

    /**
     * A wrong-password sign-in in its own process, starting at `$startAt`.
     *
     * @return array{resource, array<int, resource>}
     */
    private function startSignIn(string $userName, string $address, float $startAt): array
    {
        $process = proc_open(
            [PHP_BINARY, __DIR__ . '/../Support/sign-in-race.php', (string) $startAt, $userName, $address],
            [1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
            $pipes,
        );
        self::assertIsResource($process);

        return [$process, $pipes];
    }

    /**
     * @param resource             $process
     * @param array<int, resource> $pipes
     */
    private function exitCode($process, array $pipes): int
    {
        $errors = stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        $exitCode = proc_close($process);
        self::assertContains($exitCode, [self::CHECKED, self::REFUSED], (string) $errors);

        return $exitCode;
    }

    private function waitForAttempts(string $address, int $count): void
    {
        $deadline = microtime(true) + 10.0;
        while (microtime(true) < $deadline) {
            if (count($this->rows("SELECT id FROM login_attempts WHERE client_address = '{$address}'")) >= $count) {
                return;
            }
            usleep(10_000);
        }
        self::fail("{$count} attempts from {$address} never reserved");
    }

    private function setDanielsHash(string $hash): void
    {
        $this->otherSession()->prepare("UPDATE accounts SET password_hash = ? WHERE user_name = 'daniel'")->execute([$hash]);
    }

    /** A sign-in as daniel from the address, through the API. */
    private function attempt(string $address, string $password = self::DANIEL): ResponseInterface
    {
        return $this->send('POST', '/api/session', ['userName' => 'daniel', 'password' => $password], clientAddress: $address);
    }
}
