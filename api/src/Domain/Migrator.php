<?php

declare(strict_types=1);

namespace Performance\Domain;

use PDO;
use RuntimeException;
use Throwable;

/**
 * Brings the schema up to date under a database lock. Each migration is
 * recorded as `started` before and `completed` after its DDL in
 * `schema_migrations`; a failure is recorded as `failed` and retried on the next run.
 */
final class Migrator
{
    private const TABLE = 'schema_migrations';

    /** @var array<string, Migration> */
    private array $migrations;

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
                $migration = require $file;
                if (!$migration instanceof Migration) {
                    throw new RuntimeException('Migration file does not return a Migration: ' . basename($file));
                }
                $migrations[basename($file, '.php')] = $migration;
            }
        }

        return new self($pdo, $migrations);
    }

    /**
     * The lock is server-wide in MySQL, so its name carries the database name.
     */
    public static function lockName(PDO $pdo): string
    {
        $database = self::scalar($pdo, 'SELECT DATABASE()');

        return 'performance.migrate.' . substr($database, 0, 40);
    }

    /**
     * Applies pending migrations unless another session holds the lock.
     */
    public function migrate(): MigrationState
    {
        if ($this->pending() === []) {
            return MigrationState::Ok;
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
     * The number of the newest migration up to which every migration is completed; 0 for none.
     */
    public function schemaVersion(): int
    {
        $completed = $this->completed();
        $version = 0;
        foreach (array_keys($this->migrations) as $name) {
            if (!in_array($name, $completed, true)) {
                break;
            }
            $version = (int) substr($name, 0, 4);
        }

        return $version;
    }

    private function applyPending(): MigrationState
    {
        // Re-read under the lock: the previous holder may have finished them.
        foreach ($this->pending() as $name) {
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
     * @return list<string>
     */
    private function pending(): array
    {
        return array_values(array_diff(array_keys($this->migrations), $this->completed()));
    }

    /**
     * @return list<string>
     */
    private function completed(): array
    {
        if (!$this->hasBookkeeping()) {
            return [];
        }
        $statement = $this->pdo->query("SELECT version FROM schema_migrations WHERE state = 'completed'");
        if ($statement === false) {
            return [];
        }

        $names = [];
        foreach ($statement->fetchAll(PDO::FETCH_COLUMN) as $name) {
            if (is_string($name)) {
                $names[] = $name;
            }
        }

        return $names;
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
