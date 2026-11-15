<?php

declare(strict_types=1);

namespace Performance\Tests\Integration;

use PDO;
use Performance\Domain\Accounts;
use Performance\Domain\InvalidCredentials;
use Performance\Domain\Sessions;
use Performance\Domain\SystemClock;
use Performance\Tests\Support\DatabaseTestCase;

/**
 * A sign-in with the old password that overlaps a password reset or change must not
 * end with a valid session: checking the password and issuing the session happen
 * against the locked account row, and the reset or change replaces the hash and
 * revokes the sessions while it holds that same lock.
 */
final class SignInPasswordRaceTest extends DatabaseTestCase
{
    private const SIGNED_IN = 0;
    private const REFUSED = 2;
    private const OLD = 'altes-passwort-1';
    private const NEW = 'neues-passwort-1';

    protected function setUp(): void
    {
        parent::setUp();
        $this->get('/api/health');
        $this->createAccount('daniel', self::OLD);
    }

    /**
     * The whole sign-in runs in its own process. A reset is open on another connection
     * (new hash written, row locked, not yet committed), so the sign-in still reads and
     * verifies the old hash and then has to wait. The reset revokes the sessions and
     * commits; the sign-in resumes and must be refused.
     */
    public function testASignInPausedAfterVerifyingTheOldPasswordGetsNoSessionOnceAResetCommits(): void
    {
        $reset = $this->otherSession();
        $reset->beginTransaction();
        $reset->prepare('UPDATE accounts SET password_hash = ? WHERE id = ?')
            ->execute([password_hash(self::NEW, PASSWORD_DEFAULT), $this->danielId()]);

        [$process, $pipes] = $this->startSignIn('daniel', self::OLD);
        $this->waitUntilALockWaits();
        $reset->prepare('DELETE FROM sessions WHERE account_id = ?')->execute([$this->danielId()]);
        $reset->commit();

        self::assertSame(self::REFUSED, $this->exitCode($process, $pipes), 'the old password must not sign in');
        self::assertSame([], $this->danielsSessions());
    }

    /** Sign-in is paused between verifying the old password and issuing the session; an admin resets meanwhile. */
    public function testAnAdminResetBetweenVerifyingAndIssuingRefusesTheSession(): void
    {
        [$accounts, $sessions] = $this->modulesOnTheirOwnConnection();
        $credential = $accounts->verify('daniel', self::OLD);
        self::assertNotNull($credential);

        $reset = $this->send('PATCH', "/api/accounts/{$this->danielId()}", ['password' => self::NEW], $this->signIn());
        self::assertSame(200, $reset->getStatusCode(), (string) $reset->getBody());

        try {
            $sessions->start($credential);
            self::fail('a session for the old password');
        } catch (InvalidCredentials) {
        }
        self::assertSame([], $this->danielsSessions());
        $this->signIn('daniel', self::NEW);
    }

    /** The same with the account changing its own password on another device. */
    public function testAnOwnPasswordChangeBetweenVerifyingAndIssuingRefusesTheSession(): void
    {
        $laptop = $this->signIn('daniel', self::OLD);
        [$accounts, $sessions] = $this->modulesOnTheirOwnConnection();
        $credential = $accounts->verify('daniel', self::OLD);
        self::assertNotNull($credential);

        $change = $this->send('PUT', '/api/session/password', ['currentPassword' => self::OLD, 'newPassword' => self::NEW], $laptop);
        self::assertSame(204, $change->getStatusCode(), (string) $change->getBody());

        try {
            $sessions->start($credential);
            self::fail('a session for the old password');
        } catch (InvalidCredentials) {
        }
        self::assertCount(1, $this->danielsSessions(), 'only the device that changed the password stays signed in');
        self::assertSame(200, $this->send('GET', '/api/session', session: $laptop)->getStatusCode());
    }

    /** A sign-in that won the lock first is revoked by the reset that follows. */
    public function testASessionIssuedBeforeTheResetIsRevokedByIt(): void
    {
        [$accounts, $sessions] = $this->modulesOnTheirOwnConnection();
        $credential = $accounts->verify('daniel', self::OLD);
        self::assertNotNull($credential);
        $issued = $sessions->start($credential);

        $reset = $this->send('PATCH', "/api/accounts/{$this->danielId()}", ['password' => self::NEW], $this->signIn());
        self::assertSame(200, $reset->getStatusCode());

        self::assertSame(401, $this->send('GET', '/api/session', session: $issued->token)->getStatusCode());
        self::assertSame([], $this->danielsSessions());
    }

    /** @return array{Accounts, Sessions} on a connection of their own, as a concurrent request has */
    private function modulesOnTheirOwnConnection(): array
    {
        $pdo = $this->otherSession();
        $pdo->exec("SET time_zone = '+00:00'");
        $clock = new SystemClock();
        $accounts = new Accounts($pdo, $clock);

        return [$accounts, new Sessions($pdo, $accounts, $clock)];
    }

    private function danielId(): int
    {
        $rows = $this->rows("SELECT id FROM accounts WHERE user_name = 'daniel'");
        self::assertCount(1, $rows);
        $id = $rows[0]['id'];
        self::assertIsNumeric($id);

        return (int) $id;
    }

    /** @return list<array<string, mixed>> */
    private function danielsSessions(): array
    {
        return $this->rows("SELECT token_hash FROM sessions WHERE account_id = {$this->danielId()}");
    }

    /**
     * @return array{resource, array<int, resource>}
     */
    private function startSignIn(string $userName, string $password): array
    {
        $process = proc_open(
            [PHP_BINARY, __DIR__ . '/../Support/sign-in-paused.php', $userName, $password],
            [1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
            $pipes,
        );
        self::assertIsResource($process);

        return [$process, $pipes];
    }

    /** The sign-in verified the old hash and now waits for the account row the open reset holds. */
    private function waitUntilALockWaits(): void
    {
        $observer = $this->otherSession();
        $deadline = microtime(true) + 10.0;
        while (microtime(true) < $deadline) {
            $waiting = $observer->query("SELECT COUNT(*) FROM information_schema.INNODB_TRX WHERE trx_state = 'LOCK WAIT'");
            self::assertNotFalse($waiting);
            if ((int) $waiting->fetchColumn() > 0) {
                return;
            }
            // InnoDB refreshes this table only when it was not read for 100 ms.
            usleep(200_000);
        }
        self::fail('the sign-in never waited for the account row the reset holds');
    }

    /**
     * @param resource                $process
     * @param array<int, resource>    $pipes
     */
    private function exitCode($process, array $pipes): int
    {
        $errors = stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        $exitCode = proc_close($process);
        self::assertContains($exitCode, [self::SIGNED_IN, self::REFUSED], (string) $errors);

        return $exitCode;
    }
}
