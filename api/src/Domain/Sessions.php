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
     *
     * The session row is read under a shared lock, so a sign-out, password reset, account
     * deletion or purge of expired sessions that is under way finishes first and the session
     * is then seen gone: the answer is the session as it is when this returns, never as it was
     * before a revocation that has committed. The renewal changes the row only while it is
     * still the one read and still valid; an update of no row is never taken for success.
     * Each statement locks one row and holds nothing else, so none can deadlock with account
     * changes, which lock the account before its sessions.
     */
    public function verify(string $token): ?Account
    {
        $now = $this->clock->now();
        $hash = self::tokenHash($token);
        $lastSeenAt = $this->validSession($hash, $now)['last_seen_at'] ?? null;
        if (!is_string($lastSeenAt)) {
            return null;
        }
        if (!$this->renew($hash, $lastSeenAt, $now) && $this->validSession($hash, $now) === null) {
            return null;
        }

        return $this->accountOf($hash, $now);
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

    /**
     * The session of a token hash that has not expired, read under a shared lock (waiting for
     * a change of the row that is under way), or null.
     *
     * @return array<string, scalar|null>|null
     */
    private function validSession(string $hash, DateTimeImmutable $now): ?array
    {
        $statement = $this->pdo->prepare(
            'SELECT account_id, last_seen_at FROM sessions WHERE token_hash = ? AND expires_at > ? LOCK IN SHARE MODE',
        );
        $statement->execute([$hash, Timestamp::of($now)]);
        /** @var array<string, scalar|null>|false $row */
        $row = $statement->fetch(PDO::FETCH_ASSOC);

        return $row === false ? null : $row;
    }

    /**
     * Extends the session from `$now`, but only if it is still valid and nobody renewed it
     * since it was read (`$lastSeenAt`): true when this request renewed it.
     */
    private function renew(string $hash, string $lastSeenAt, DateTimeImmutable $now): bool
    {
        if ($lastSeenAt >= Timestamp::of($now)) {
            return false;
        }
        $renewal = $this->pdo->prepare(
            'UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ? AND last_seen_at = ? AND expires_at > ?',
        );
        $renewal->execute([Timestamp::of($now), Timestamp::of($now->add(self::lifetime())), $hash, $lastSeenAt, Timestamp::of($now)]);

        return $renewal->rowCount() === 1;
    }

    /** The account of a session that is still valid, or null when the session or the account is gone. */
    private function accountOf(string $hash, DateTimeImmutable $now): ?Account
    {
        $statement = $this->pdo->prepare(
            'SELECT a.id, a.user_name, a.is_admin FROM sessions s JOIN accounts a ON a.id = s.account_id
             WHERE s.token_hash = ? AND s.expires_at > ?',
        );
        $statement->execute([$hash, Timestamp::of($now)]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);

        return is_array($row) ? Account::fromRow($row) : null;
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
