<?php

declare(strict_types=1);

namespace Performance\Domain;

use PDO;
use PDOException;
use Throwable;

/**
 * Personal accounts: user names (unique regardless of case), password hashes,
 * the admin flag, the bootstrap admin and the rule that one admin always remains.
 */
final readonly class Accounts
{
    public const MAX_USER_NAME_LENGTH = 40;

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
        $hash = is_string($row['password_hash'] ?? null) ? $row['password_hash'] : PasswordPolicy::unknownUserHash();
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
        $hash = is_string($row['password_hash'] ?? null) ? $row['password_hash'] : PasswordPolicy::unknownUserHash();
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
     * An admin's change to an account: grant or revoke admin rights (`$isAdmin`), reset
     * the password (`$password`); null leaves that part as it is. A reset signs the
     * account out everywhere.
     *
     * @throws ValidationFailed for a new password that breaks the policy
     * @throws NotFound for an unknown account
     * @throws LastAdmin when it would demote the last admin
     */
    public function update(int $id, ?bool $isAdmin, ?string $password): Account
    {
        $passwordError = $password === null ? null : PasswordPolicy::violation($password);
        if ($passwordError !== null) {
            throw new ValidationFailed(['password' => $passwordError]);
        }
        // Hashing is slow on purpose: done before the transaction, so the admin rows stay locked briefly.
        $hash = $password === null ? null : PasswordPolicy::hash($password);

        return $this->changeLocked($id, function (Account $account, int $admins) use ($isAdmin, $hash): Account {
            $now = Timestamp::of($this->clock->now());
            if ($isAdmin !== null && $isAdmin !== $account->isAdmin) {
                if (!$isAdmin) {
                    self::keepAnAdmin($account, $admins);
                }
                $this->pdo->prepare('UPDATE accounts SET is_admin = ?, updated_at = ? WHERE id = ?')
                    ->execute([(int) $isAdmin, $now, $account->id]);
                $account = new Account($account->id, $account->userName, $isAdmin);
            }
            if ($hash !== null) {
                $this->pdo->prepare('UPDATE accounts SET password_hash = ?, updated_at = ? WHERE id = ?')
                    ->execute([$hash, $now, $account->id]);
                $this->pdo->prepare('DELETE FROM sessions WHERE account_id = ?')->execute([$account->id]);
            }

            return $account;
        });
    }

    /**
     * Deletes the account. Its sessions go with it and its entries stay with their
     * "logged by" reference cleared (both by foreign key).
     *
     * @throws NotFound for an unknown account
     * @throws LastAdmin when it is the last admin
     */
    public function delete(int $id): void
    {
        $this->changeLocked($id, function (Account $account, int $admins): void {
            self::keepAnAdmin($account, $admins);
            $this->pdo->prepare('DELETE FROM accounts WHERE id = ?')->execute([$account->id]);
        });
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

    /**
     * Runs a change to one account in a transaction that first locks that account and
     * every admin. Concurrent demotions and deletions therefore run one after the other,
     * and each one counts the admins the previous one left.
     *
     * @template T
     *
     * @param callable(Account, int): T $change gets the account and the number of admins
     *
     * @return T
     */
    private function changeLocked(int $id, callable $change): mixed
    {
        $this->pdo->beginTransaction();
        try {
            $statement = $this->pdo->prepare(
                'SELECT id, user_name, is_admin FROM accounts WHERE is_admin = 1 OR id = ? ORDER BY id FOR UPDATE',
            );
            $statement->execute([$id]);
            $account = null;
            $admins = 0;
            foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
                if (!is_array($row)) {
                    continue;
                }
                $locked = Account::fromRow($row);
                $admins += (int) $locked->isAdmin;
                if ($locked->id === $id) {
                    $account = $locked;
                }
            }
            if ($account === null) {
                throw new NotFound("No account {$id}");
            }
            $result = $change($account, $admins);
            $this->pdo->commit();

            return $result;
        } catch (Throwable $failure) {
            $this->pdo->rollBack();
            throw $failure;
        }
    }

    /** @throws LastAdmin when the account is the only admin left */
    private static function keepAnAdmin(Account $account, int $admins): void
    {
        if ($account->isAdmin && $admins <= 1) {
            throw new LastAdmin("Account {$account->id} is the last admin");
        }
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
