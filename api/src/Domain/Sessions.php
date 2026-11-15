<?php

declare(strict_types=1);

namespace Performance\Domain;

use DateInterval;
use DateTimeImmutable;
use PDO;

/**
 * Sign-in sessions: a random 256-bit token per sign-in, of which only the SHA-256
 * hash is stored; valid for 180 days from its last use. Sign-in is throttled per
 * user name and client address.
 */
final readonly class Sessions
{
    public const LIFETIME_DAYS = 180;
    public const MAX_FAILURES = 5;
    public const FAILURE_WINDOW_MINUTES = 15;

    public function __construct(
        private PDO $pdo,
        private Accounts $accounts,
        private Clock $clock,
    ) {}

    /**
     * @throws TooManyAttempts after five failures for this user name and address in the window
     * @throws InvalidCredentials for an unknown user name or a wrong password alike
     */
    public function signIn(string $userName, string $password, string $clientAddress): IssuedSession
    {
        $userName = mb_substr(trim($userName), 0, 255, 'UTF-8');
        if ($this->recentFailures($userName, $clientAddress) >= self::MAX_FAILURES) {
            throw new TooManyAttempts();
        }
        $account = $this->accounts->authenticate($userName, $password);
        if ($account === null) {
            $this->recordFailure($userName, $clientAddress);
            throw new InvalidCredentials();
        }
        $this->forgetFailures($userName, $clientAddress);

        return $this->issue($account);
    }

    /**
     * The signed-in account of a token that is known and not expired; using it extends the session.
     */
    public function verify(string $token): ?Account
    {
        $now = $this->clock->now();
        $statement = $this->pdo->prepare(
            'SELECT a.id, a.user_name, a.is_admin FROM sessions s JOIN accounts a ON a.id = s.account_id
             WHERE s.token_hash = ? AND s.expires_at > ?',
        );
        $statement->execute([self::hash($token), Timestamp::of($now)]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        if (!is_array($row)) {
            return null;
        }
        $this->pdo->prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?')
            ->execute([Timestamp::of($now), Timestamp::of($now->add(self::lifetime())), self::hash($token)]);

        return Account::fromRow($row);
    }

    public function revoke(string $token): void
    {
        $this->pdo->prepare('DELETE FROM sessions WHERE token_hash = ?')->execute([self::hash($token)]);
    }

    /** Signs the account out everywhere except on the device that holds the given token. */
    public function revokeOthers(int $accountId, string $keptToken): void
    {
        $this->pdo->prepare('DELETE FROM sessions WHERE account_id = ? AND token_hash <> ?')
            ->execute([$accountId, self::hash($keptToken)]);
    }

    public static function lifetimeSeconds(): int
    {
        return self::LIFETIME_DAYS * 24 * 60 * 60;
    }

    private function issue(Account $account): IssuedSession
    {
        $token = bin2hex(random_bytes(32));
        $now = $this->clock->now();
        $this->pdo->prepare(
            'INSERT INTO sessions (token_hash, account_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)',
        )->execute([
            self::hash($token),
            $account->id,
            Timestamp::of($now),
            Timestamp::of($now),
            Timestamp::of($now->add(self::lifetime())),
        ]);

        return new IssuedSession($token, $account);
    }

    private function recentFailures(string $userName, string $clientAddress): int
    {
        $statement = $this->pdo->prepare(
            'SELECT COUNT(*) FROM login_attempts WHERE user_name = ? AND client_address = ? AND attempted_at > ?',
        );
        $statement->execute([$userName, $clientAddress, Timestamp::of($this->windowStart())]);

        return (int) $statement->fetchColumn();
    }

    /** Records the failure and drops attempts that left the window, so the table stays small. */
    private function recordFailure(string $userName, string $clientAddress): void
    {
        $this->pdo->prepare('DELETE FROM login_attempts WHERE attempted_at <= ?')
            ->execute([Timestamp::of($this->windowStart())]);
        $this->pdo->prepare('INSERT INTO login_attempts (user_name, client_address, attempted_at) VALUES (?, ?, ?)')
            ->execute([$userName, $clientAddress, Timestamp::of($this->clock->now())]);
    }

    private function forgetFailures(string $userName, string $clientAddress): void
    {
        $this->pdo->prepare('DELETE FROM login_attempts WHERE user_name = ? AND client_address = ?')
            ->execute([$userName, $clientAddress]);
    }

    private function windowStart(): DateTimeImmutable
    {
        return $this->clock->now()->sub(new DateInterval(sprintf('PT%dM', self::FAILURE_WINDOW_MINUTES)));
    }

    private static function lifetime(): DateInterval
    {
        return new DateInterval(sprintf('P%dD', self::LIFETIME_DAYS));
    }

    private static function hash(string $token): string
    {
        return hash('sha256', $token);
    }
}
