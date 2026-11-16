<?php

declare(strict_types=1);

namespace Performance\Tests\Integration;

use DateInterval;
use DateTimeImmutable;
use DateTimeZone;
use PDO;
use Performance\Domain\Timestamp;
use Performance\Tests\Support\DatabaseTestCase;
use PHPUnit\Framework\Attributes\DataProvider;

/**
 * A request that is validated while its session is being revoked. The revocation is open on
 * another connection with the statements the API runs for it (the session row is then
 * locked, the change not yet committed); the request starts in its own process and the test
 * waits until it waits for that row; then the revocation commits. The request must be
 * refused: once a revocation has committed, no request authorized by the old session starts,
 * and no cookie for it is issued. The order is the same on every run.
 */
final class SessionRevocationRaceTest extends DatabaseTestCase
{
    private const PASSWORD = 'daniels-passwort';

    private string $token;
    private int $danielId;
    /** The request's clock: two days after the sign-in (due for renewal) unless a test says otherwise. */
    private DateTimeImmutable $requestAt;

    protected function setUp(): void
    {
        parent::setUp();
        $this->createAccount('daniel', self::PASSWORD);
        $this->token = $this->signIn('daniel', self::PASSWORD);
        $rows = $this->rows("SELECT id FROM accounts WHERE user_name = 'daniel'");
        self::assertIsNumeric($rows[0]['id'] ?? null);
        $this->danielId = (int) $rows[0]['id'];
        $this->requestAt = $this->clock->now()->add(new DateInterval('P2D'));
    }

    /**
     * @return iterable<string, array{string, string}>
     */
    public static function revocations(): iterable
    {
        foreach (['sign-out', 'password reset', 'account deletion', 'expiry'] as $revocation) {
            // Two days after the sign-in the request renews the session; an hour after, it only reads it.
            yield "{$revocation}, renewal due" => [$revocation, 'P2D'];
            yield "{$revocation}, no renewal due" => [$revocation, 'PT1H'];
        }
    }

    #[DataProvider('revocations')]
    public function testARequestValidatedWhileItsSessionIsRevokedIsRefusedOnceTheRevocationCommits(string $revocation, string $after): void
    {
        $this->requestAt = $this->clock->now()->add(new DateInterval($after));
        $revoking = $this->openRevocation($revocation);

        [$process, $pipes] = $this->startRequest();
        $this->waitUntilLocksWait(1);
        $revoking->commit();

        $answer = $this->answer($process, $pipes);
        self::assertSame(401, $answer['status'], 'a revoked session authorizes nothing');
        self::assertSame('', $answer['setCookie'], 'and gets no cookie');
        self::assertSame([], $this->rows('SELECT token_hash FROM sessions WHERE account_id = ' . $this->danielId));
    }

    /**
     * Two requests due for a renewal read the session at the same moment. One renews it and
     * sets the cookie; the other finds it renewed (its update changes no row), which is no
     * reason to refuse it: both pass, and the session is renewed once.
     */
    public function testTwoRequestsDueForARenewalAtOnceBothPassAndRenewItOnce(): void
    {
        $holder = $this->otherSession();
        $holder->beginTransaction();
        $holder->prepare('SELECT token_hash FROM sessions WHERE account_id = ? FOR UPDATE')->execute([$this->danielId]);

        $first = $this->startRequest();
        $second = $this->startRequest();
        $this->waitUntilLocksWait(2);
        $holder->commit();

        $answers = [$this->answer(...$first), $this->answer(...$second)];
        self::assertSame([200, 200], array_column($answers, 'status'));
        self::assertCount(1, array_filter($answers, static fn(array $answer): bool => $answer['setCookie'] !== ''), 'one renewal, one cookie');
        self::assertSame(
            [['expires_at' => Timestamp::of($this->requestAt->add(new DateInterval('P180D')))]],
            $this->rows('SELECT expires_at FROM sessions WHERE account_id = ' . $this->danielId),
        );
    }

    /** Opens the revocation's transaction on another connection and runs its statements, without committing. */
    private function openRevocation(string $revocation): PDO
    {
        if ($revocation === 'expiry') {
            // The session runs out a second after the request's clock; a sign-in a second later drops it.
            $this->otherSession()->prepare('UPDATE sessions SET expires_at = ? WHERE account_id = ?')
                ->execute([Timestamp::of($this->requestAt->add(new DateInterval('PT1S'))), $this->danielId]);
        }
        $revoking = $this->otherSession();
        $revoking->beginTransaction();
        foreach (self::statements($revocation) as [$sql, $parameters]) {
            $revoking->prepare($sql)->execute($parameters);
        }

        return $revoking;
    }

    /**
     * The statements the API runs for a revocation, in its order. Account changes lock the
     * account and every admin first (Accounts::changeLocked).
     *
     * @return list<array{string, list<int|string>}>
     */
    private function statements(string $revocation): array
    {
        $lockAccounts = ['SELECT id FROM accounts WHERE is_admin = 1 OR id = ? ORDER BY id FOR UPDATE', [$this->danielId]];

        return match ($revocation) {
            'sign-out' => [['DELETE FROM sessions WHERE token_hash = ?', [hash('sha256', $this->token)]]],
            'password reset' => [
                $lockAccounts,
                ['UPDATE accounts SET password_hash = ? WHERE id = ?', [password_hash('neues-passwort-1', PASSWORD_DEFAULT), $this->danielId]],
                ['DELETE FROM sessions WHERE account_id = ?', [$this->danielId]],
            ],
            'account deletion' => [$lockAccounts, ['DELETE FROM accounts WHERE id = ?', [$this->danielId]]],
            'expiry' => [['DELETE FROM sessions WHERE expires_at <= ?', [Timestamp::of($this->requestAt->add(new DateInterval('PT2S')))]]],
            default => self::fail("unknown revocation {$revocation}"),
        };
    }

    /**
     * @return array{resource, array<int, resource>}
     */
    private function startRequest(): array
    {
        $process = proc_open(
            [
                PHP_BINARY,
                __DIR__ . '/../Support/session-request.php',
                $this->token,
                $this->requestAt->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s'),
            ],
            [1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
            $pipes,
        );
        self::assertIsResource($process);

        return [$process, $pipes];
    }

    /** `$count` requests now wait for the session row another connection holds. */
    private function waitUntilLocksWait(int $count): void
    {
        $observer = $this->otherSession();
        $deadline = microtime(true) + 10.0;
        while (microtime(true) < $deadline) {
            $waiting = $observer->query("SELECT COUNT(*) FROM information_schema.INNODB_TRX WHERE trx_state = 'LOCK WAIT'");
            self::assertNotFalse($waiting);
            if ((int) $waiting->fetchColumn() >= $count) {
                return;
            }
            // InnoDB refreshes this table only when it was not read for 100 ms.
            usleep(200_000);
        }
        self::fail("{$count} requests never waited for the session row");
    }

    /**
     * @param resource             $process
     * @param array<int, resource> $pipes
     *
     * @return array{status: int, setCookie: string}
     */
    private function answer($process, array $pipes): array
    {
        $output = (string) stream_get_contents($pipes[1]);
        $errors = (string) stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        self::assertSame(0, proc_close($process), $errors);
        $answer = json_decode($output, true, flags: JSON_THROW_ON_ERROR);
        self::assertIsArray($answer);
        self::assertIsInt($answer['status'] ?? null);
        self::assertIsString($answer['setCookie'] ?? null);

        return ['status' => $answer['status'], 'setCookie' => $answer['setCookie']];
    }
}
