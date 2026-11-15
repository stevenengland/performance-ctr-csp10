<?php

declare(strict_types=1);

namespace Performance\Domain;

use PDO;
use PDOException;

/**
 * Personal accounts: user names (unique regardless of case), password hashes,
 * the admin flag and the bootstrap admin.
 */
final readonly class Accounts
{
    public const MAX_USER_NAME_LENGTH = 40;

    /**
     * What an unknown user name is checked against, so it costs the same as a wrong
     * password: the hash of a random password that was thrown away.
     */
    private const UNKNOWN_USER_HASH = '$2y$10$Wdlo7D986U3W5wuCoDcDAu8CEr7KJSGm4wklvd3t/GWbtV8p0Cpgi';

    public function __construct(
        private PDO $pdo,
        private Clock $clock,
    ) {}

    /**
     * Creates the bootstrap admin when no admin exists. It never touches an existing
     * account: a taken user name leaves everything as it is. The statement checks for
     * an admin and inserts in one step and the unique user name settles concurrent
     * first requests, so exactly one of them creates the account.
     */
    public function ensureBootstrapAdmin(BootstrapAdmin $admin): void
    {
        if ($this->adminExists()) {
            return;
        }
        $now = Timestamp::of($this->clock->now());
        try {
            $this->pdo->prepare(
                'INSERT INTO accounts (user_name, password_hash, is_admin, created_at, updated_at)
                 SELECT ?, ?, 1, ?, ? FROM DUAL
                 WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE is_admin = 1)',
            )->execute([trim($admin->userName), $admin->passwordHash, $now, $now]);
        } catch (PDOException $failure) {
            if (!DatabaseError::is($failure, DatabaseError::DUPLICATE_KEY, DatabaseError::DEADLOCK)) {
                throw $failure;
            }
        }
    }

    /**
     * @throws ValidationFailed for a user name outside 1–40 characters or a short password
     * @throws DuplicateUserName when the name is taken, ignoring case
     */
    public function create(string $userName, string $password, bool $isAdmin = false): Account
    {
        $userName = trim($userName);
        $errors = [];
        $length = mb_strlen($userName, 'UTF-8');
        if ($length < 1 || $length > self::MAX_USER_NAME_LENGTH) {
            $errors['userName'] = sprintf('1 bis %d Zeichen.', self::MAX_USER_NAME_LENGTH);
        }
        $passwordError = PasswordPolicy::violation($password);
        if ($passwordError !== null) {
            $errors['password'] = $passwordError;
        }
        if ($errors !== []) {
            throw new ValidationFailed($errors);
        }

        $now = Timestamp::of($this->clock->now());
        try {
            $this->pdo->prepare(
                'INSERT INTO accounts (user_name, password_hash, is_admin, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
            )->execute([$userName, PasswordPolicy::hash($password), (int) $isAdmin, $now, $now]);
        } catch (PDOException $failure) {
            if (DatabaseError::is($failure, DatabaseError::DUPLICATE_KEY)) {
                throw new DuplicateUserName($userName, 0, $failure);
            }
            throw $failure;
        }

        return new Account((int) $this->pdo->lastInsertId(), $userName, $isAdmin);
    }

    /**
     * The account whose password matches; null for an unknown name or a wrong password,
     * which take the same time.
     */
    public function authenticate(string $userName, string $password): ?Account
    {
        $row = $this->row('SELECT id, user_name, is_admin, password_hash FROM accounts WHERE user_name = ?', [trim($userName)]);
        $hash = is_string($row['password_hash'] ?? null) ? $row['password_hash'] : self::UNKNOWN_USER_HASH;
        if (!password_verify($password, $hash) || $row === null) {
            return null;
        }
        $account = Account::fromRow($row);
        if (password_needs_rehash($hash, PASSWORD_DEFAULT)) {
            $this->storePassword($account->id, $password);
        }

        return $account;
    }

    /**
     * @throws ValidationFailed for a wrong current password or a new one that breaks the policy
     */
    public function changePassword(int $accountId, string $currentPassword, string $newPassword): void
    {
        $row = $this->row('SELECT password_hash FROM accounts WHERE id = ?', [$accountId]);
        $hash = is_string($row['password_hash'] ?? null) ? $row['password_hash'] : self::UNKNOWN_USER_HASH;
        $errors = [];
        if (!password_verify($currentPassword, $hash)) {
            $errors['currentPassword'] = 'Passwort falsch.';
        }
        $policyError = PasswordPolicy::violation($newPassword);
        if ($policyError !== null) {
            $errors['newPassword'] = $policyError;
        }
        if ($errors !== []) {
            throw new ValidationFailed($errors);
        }
        $this->storePassword($accountId, $newPassword);
    }

    /**
     * @return list<Account> ordered by user name
     */
    public function list(): array
    {
        $statement = $this->pdo->query('SELECT id, user_name, is_admin FROM accounts ORDER BY user_name, id');
        $accounts = [];
        foreach ($statement === false ? [] : $statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
            if (is_array($row)) {
                $accounts[] = Account::fromRow($row);
            }
        }

        return $accounts;
    }

    private function adminExists(): bool
    {
        return $this->row('SELECT 1 AS found FROM accounts WHERE is_admin = 1 LIMIT 1', []) !== null;
    }

    private function storePassword(int $accountId, string $password): void
    {
        $this->pdo->prepare('UPDATE accounts SET password_hash = ?, updated_at = ? WHERE id = ?')
            ->execute([PasswordPolicy::hash($password), Timestamp::of($this->clock->now()), $accountId]);
    }

    /**
     * @param list<int|string> $parameters
     *
     * @return array<string, mixed>|null
     */
    private function row(string $sql, array $parameters): ?array
    {
        $statement = $this->pdo->prepare($sql);
        $statement->execute($parameters);
        $row = $statement->fetch(PDO::FETCH_ASSOC);

        /** @var array<string, mixed>|false $row */
        return $row === false ? null : $row;
    }
}
