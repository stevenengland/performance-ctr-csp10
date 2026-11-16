<?php

declare(strict_types=1);

namespace Performance\Domain;

use PDO;
use PDOException;
use RuntimeException;
use Throwable;

/**
 * Brings the schema up to date under a database lock. Each migration is
 * recorded as `started` before and `completed` after its DDL in
 * `schema_migrations`; a failure is recorded as `failed` and retried on a later run,
 * at most once per FAILED_RETRY_SECONDS unless the caller asks for it at once.
 */
final class Migrator
{
    private const TABLE = 'schema_migrations';
    /** MySQL's and MariaDB's SQLSTATE for a table that does not exist. */
    private const NO_SUCH_TABLE = '42S02';
    /** After a failure, ordinary requests (every phone's scoreboard poll) retry no sooner. */
    public const FAILED_RETRY_SECONDS = 60;

    /** @var array<string, Migration> */
    private array $migrations;

    /**
     * Every migration file loaded in this process, by path. Each `require` of a file that
     * returns an anonymous class compiles it again and declares one more class, which PHP never
     * frees, so a long process (the test suite, one Migrator per request) would grow without
     * bound. A request loads each file once anyway, so production is unchanged.
     *
     * @var array<string, Migration>
     */
    private static array $loaded = [];

    /**
     * @param array<string, Migration> $migrations keyed by name (`NNNN_snake_case`)
     */
    public function __construct(
        private readonly PDO $pdo,
        array $migrations,
    ) {
        ksort($migrations, SORT_STRING);
        $this->migrations = $migrations;
    }

    /**
     * Loads every `NNNN_snake_case.php` file of the given directories; each returns a Migration.
     */
    public static function fromDirectories(PDO $pdo, string ...$directories): self
    {
        $migrations = [];
        foreach ($directories as $directory) {
            foreach (glob($directory . '/[0-9][0-9][0-9][0-9]_*.php') ?: [] as $file) {
                $migrations[basename($file, '.php')] = self::$loaded[$file] ??= self::load($file);
            }
        }

        return new self($pdo, $migrations);
    }

    private static function load(string $file): Migration
    {
        $migration = require $file;
        if (!$migration instanceof Migration) {
            throw new RuntimeException('Migration file does not return a Migration: ' . basename($file));
        }

        return $migration;
    }

    /**
     * The lock is server-wide in MariaDB (and MySQL), so its name carries the database name.
     */
    public static function lockName(PDO $pdo): string
    {
        $database = self::scalar($pdo, 'SELECT DATABASE()');

        return 'performance.migrate.' . substr($database, 0, 40);
    }

    /**
     * Applies pending migrations unless another session holds the lock. Up to date costs
     * one small query. After a failure, the failing migration runs again only when
     * `$retryFailedNow` (health, which the deploy checks) or once the last attempt is
     * FAILED_RETRY_SECONDS old, so polling phones do not re-run broken DDL every request.
     */
    public function migrate(bool $retryFailedNow = true): MigrationState
    {
        $bookkeeping = $this->bookkeeping();
        if ($this->pending($bookkeeping) === []) {
            return MigrationState::Ok;
        }
        if (!$retryFailedNow && $this->failedRecently($bookkeeping)) {
            return MigrationState::Failed;
        }
        $lock = self::lockName($this->pdo);
        if (!$this->acquire($lock)) {
            return MigrationState::Running;
        }
        try {
            return $this->applyPending();
        } finally {
            $this->release($lock);
        }
    }

    /**
     * The schema the database is at: the number of the newest migration up to which every
     * migration of this release is completed, or, when a newer release already completed
     * migrations this release does not know, the newest of those. An older release that
     * answers on a newer schema then says so, instead of claiming its own version. 0 for none.
     */
    public function schemaVersion(): int
    {
        $completed = $this->completed($this->bookkeeping());
        $version = 0;
        foreach (array_keys($this->migrations) as $name) {
            if (!in_array($name, $completed, true)) {
                break;
            }
            $version = (int) substr($name, 0, 4);
        }
        foreach (array_diff($completed, array_keys($this->migrations)) as $unknown) {
            $version = max($version, (int) substr($unknown, 0, 4));
        }

        return $version;
    }

    private function applyPending(): MigrationState
    {
        // Re-read under the lock: the previous holder may have finished them.
        foreach ($this->pending($this->bookkeeping()) as $name) {
            $migration = $this->migrations[$name];
            try {
                $this->record($name, 'started');
                if (!$migration->isApplied($this->pdo)) {
                    $migration->apply($this->pdo);
                }
                $this->record($name, 'completed');
            } catch (Throwable $failure) {
                error_log(sprintf('Migration %s failed: %s', $name, $failure->getMessage()));
                $this->record($name, 'failed');

                return MigrationState::Failed;
            }
        }

        return MigrationState::Ok;
    }

    /**
     * Every recorded migration: its state, and whether its last attempt started within
     * FAILED_RETRY_SECONDS. Empty before the bookkeeping table exists.
     *
     * @return array<string, array{state: string, recent: bool}>
     */
    private function bookkeeping(): array
    {
        try {
            $statement = $this->pdo->query(sprintf(
                'SELECT version, state, started_at > UTC_TIMESTAMP(3) - INTERVAL %d SECOND AS recent FROM %s',
                self::FAILED_RETRY_SECONDS,
                self::TABLE,
            ));
        } catch (PDOException $failure) {
            if ($failure->getCode() === self::NO_SUCH_TABLE) {
                return [];
            }
            throw $failure;
        }
        if ($statement === false) {
            return [];
        }
        $rows = [];
        foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
            if (is_array($row) && is_string($row['version'] ?? null) && is_string($row['state'] ?? null)) {
                // The server answers the comparison as 1 or 0, as an int or a string by driver mode.
                $rows[$row['version']] = ['state' => $row['state'], 'recent' => in_array($row['recent'] ?? null, [1, '1'], true)];
            }
        }

        return $rows;
    }

    /**
     * @param array<string, array{state: string, recent: bool}> $bookkeeping
     *
     * @return list<string>
     */
    private function pending(array $bookkeeping): array
    {
        return array_values(array_diff(array_keys($this->migrations), $this->completed($bookkeeping)));
    }

    /**
     * @param array<string, array{state: string, recent: bool}> $bookkeeping
     *
     * @return list<string>
     */
    private function completed(array $bookkeeping): array
    {
        return array_keys(array_filter($bookkeeping, static fn(array $row): bool => $row['state'] === 'completed'));
    }

    /**
     * @param array<string, array{state: string, recent: bool}> $bookkeeping
     */
    private function failedRecently(array $bookkeeping): bool
    {
        foreach ($bookkeeping as $row) {
            if ($row['state'] === 'failed' && $row['recent']) {
                return true;
            }
        }

        return false;
    }

    private function hasBookkeeping(): bool
    {
        $statement = $this->pdo->prepare(
            'SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
        );
        $statement->execute([self::TABLE]);

        return (int) $statement->fetchColumn() > 0;
    }

    /**
     * Before the first migration has created the bookkeeping table there is nothing to record into;
     * that migration's `started` is then recorded together with its `completed`.
     */
    private function record(string $name, string $state): void
    {
        if (!$this->hasBookkeeping()) {
            return;
        }
        $completedAt = $state === 'completed' ? 'UTC_TIMESTAMP(3)' : 'NULL';
        $restart = $state === 'started' ? 'started_at = UTC_TIMESTAMP(3), ' : '';
        $statement = $this->pdo->prepare(
            "INSERT INTO schema_migrations (version, state, started_at, completed_at)
             VALUES (?, ?, UTC_TIMESTAMP(3), {$completedAt})
             ON DUPLICATE KEY UPDATE {$restart}state = ?, completed_at = {$completedAt}",
        );
        $statement->execute([$name, $state, $state]);
    }

    private function acquire(string $lock): bool
    {
        $statement = $this->pdo->prepare('SELECT GET_LOCK(?, 0)');
        $statement->execute([$lock]);

        return (int) $statement->fetchColumn() === 1;
    }

    private function release(string $lock): void
    {
        $this->pdo->prepare('SELECT RELEASE_LOCK(?)')->execute([$lock]);
    }

    private static function scalar(PDO $pdo, string $sql): string
    {
        $statement = $pdo->query($sql);
        $value = $statement === false ? null : $statement->fetchColumn();

        return is_scalar($value) ? (string) $value : '';
    }
}
