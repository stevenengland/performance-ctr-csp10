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
     * The attempt is reserved in the database before the password is checked, so parallel
     * requests cannot all pass one read of the failure count (see `reserveAttempt`).
     *
     * @throws TooManyAttempts after five failures for this user name and address in the window
     * @throws InvalidCredentials for an unknown user name or a wrong password alike
     */
    public function signIn(string $userName, string $password, string $clientAddress): IssuedSession
    {
        $userName = mb_substr(trim($userName), 0, 255, 'UTF-8');
        $this->reserveAttempt($userName, $clientAddress);
        $credential = $this->accounts->verify($userName, $password);
        if ($credential === null) {
            // The reservation stays as the recorded failure.
            throw new InvalidCredentials();
        }
        // A password reset or change in the meantime refuses it, and the reservation stays.
        $session = $this->start($credential);
        $this->forgetFailures($userName, $clientAddress);

        return $session;
    }

    /**
     * Issues the session while the account's row is locked and its hash is still the one
     * the password was verified against, so it cannot outlive a concurrent reset or
     * change (which revokes sessions under the same lock).
     *
     * @throws InvalidCredentials when the password changed or the account was deleted meanwhile
     */
    public function start(Credential $credential): IssuedSession
    {
        return $this->accounts->whileCredentialHolds($credential, $this->issue(...));
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
        $statement->execute([self::tokenHash($token), Timestamp::of($now)]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        if (!is_array($row)) {
            return null;
        }
        $this->pdo->prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?')
            ->execute([Timestamp::of($now), Timestamp::of($now->add(self::lifetime())), self::tokenHash($token)]);

        return Account::fromRow($row);
    }

    public function revoke(string $token): void
    {
        $this->pdo->prepare('DELETE FROM sessions WHERE token_hash = ?')->execute([self::tokenHash($token)]);
    }

    /** What the database stores of a token: its SHA-256 hash. */
    public static function tokenHash(string $token): string
    {
        return hash('sha256', $token);
    }

    public static function lifetimeSeconds(): int
    {
        return self::LIFETIME_DAYS * 24 * 60 * 60;
    }

    /** Issues a new session and drops expired ones, so the table does not grow with every sign-in. */
    private function issue(Account $account): IssuedSession
    {
        $token = bin2hex(random_bytes(32));
        $now = $this->clock->now();
        $this->pdo->prepare('DELETE FROM sessions WHERE expires_at <= ?')->execute([Timestamp::of($now)]);
        $this->pdo->prepare(
            'INSERT INTO sessions (token_hash, account_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)',
        )->execute([
            self::tokenHash($token),
            $account->id,
            Timestamp::of($now),
            Timestamp::of($now),
            Timestamp::of($now->add(self::lifetime())),
        ]);

        return new IssuedSession($token, $account);
    }

    /**
     * Records this attempt first and only then counts the attempts in the window, itself
     * included. Each insert commits before its count, so of any set of parallel attempts
     * the k-th to count sees at least k rows: no more than MAX_FAILURES attempts ever get
     * past the count, however many arrive at once. A refused attempt removes its row
     * again, so refusals do not extend the lock; a failed one keeps it as the failure.
     * Attempts that left the window are dropped here, so the table stays small.
     *
     * @throws TooManyAttempts
     */
    private function reserveAttempt(string $userName, string $clientAddress): void
    {
        $windowStart = Timestamp::of($this->windowStart());
        $this->pdo->prepare('DELETE FROM login_attempts WHERE attempted_at <= ?')->execute([$windowStart]);
        $this->pdo->prepare('INSERT INTO login_attempts (user_name, client_address, attempted_at) VALUES (?, ?, ?)')
            ->execute([$userName, $clientAddress, Timestamp::of($this->clock->now())]);
        $reservation = (int) $this->pdo->lastInsertId();
        $count = $this->pdo->prepare(
            'SELECT COUNT(*) FROM login_attempts WHERE user_name = ? AND client_address = ? AND attempted_at > ?',
        );
        $count->execute([$userName, $clientAddress, $windowStart]);
        if ((int) $count->fetchColumn() > self::MAX_FAILURES) {
            $this->pdo->prepare('DELETE FROM login_attempts WHERE id = ?')->execute([$reservation]);

            throw new TooManyAttempts();
        }
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
}
