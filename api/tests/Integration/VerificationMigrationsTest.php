<?php

declare(strict_types=1);

namespace Performance\Tests\Integration;

use PDO;
use Performance\Domain\Migration;
use Performance\Domain\MigrationState;
use Performance\Domain\Migrator;
use Performance\Domain\Timestamp;
use Performance\Tests\Support\DatabaseTestCase;
use RuntimeException;

/**
 * The upgrade to the four-eyes rule (PRD #61) on a database the previous release filled: each
 * row table gains its verification columns (INSTANT), its pending index and its verifier
 * foreign key (both INPLACE). No step copies the table, every existing row counts afterwards,
 * every migration runs again harmlessly, and deleting the verifying account clears the verifier.
 */
final class VerificationMigrationsTest extends DatabaseTestCase
{
    /** The newest migration of the release before the four-eyes rule. */
    private const PREVIOUS_SCHEMA = '0019_create_person_photos';
    private const ENTRY_MIGRATIONS = ['0020_add_entries_verification', '0021_add_entries_pending_index', '0022_add_entries_verifier_foreign_key'];
    private const ENTRY = '6f1c2d3e-4a5b-4c6d-8e7f-90a1b2c3d4e5';

    public function testTheUpgradeKeepsEveryEntryCountingWithoutCopyingTheTable(): void
    {
        $this->migrateUpTo(self::PREVIOUS_SCHEMA);
        $this->previousReleaseRecordsAnEntry();
        $table = $this->tableId('entries');

        $health = $this->body($this->get('/api/health'));

        self::assertSame('ok', $health['migration']);
        self::assertSame($table, $this->tableId('entries'), 'the table was neither copied nor rebuilt');
        $board = $this->body($this->send('GET', '/api/scoreboard?from=2026-11-14T00:00:00Z', session: $this->signIn()));
        self::assertSame(
            ['personId' => 1, 'name' => 'Daniel', 'score' => 2.5, 'count' => 1],
            array_intersect_key(self::list($board['rows'])[0], array_flip(['personId', 'name', 'score', 'count'])),
            'the entry from before counts',
        );
    }

    public function testEachEntryMigrationRunsAgainAfterACrashBeforeItsBookkeepingWithoutChangingAnything(): void
    {
        $this->get('/api/health');
        $this->previousReleaseRecordsAnEntry();
        // A crash between each DDL and its bookkeeping: the change is in, the rows say started.
        $this->otherSession()->exec(
            "UPDATE schema_migrations SET state = 'started', completed_at = NULL WHERE version IN ('" . implode("', '", self::ENTRY_MIGRATIONS) . "')",
        );

        $health = $this->body($this->get('/api/health'));

        self::assertSame('ok', $health['migration']);
        $states = array_column($this->rows('SELECT version, state FROM schema_migrations'), 'state', 'version');
        foreach (self::ENTRY_MIGRATIONS as $name) {
            self::assertSame('completed', $states[$name], $name);
        }
        self::assertSame([['id' => self::ENTRY]], $this->rows('SELECT id FROM entries'), 'the table is kept as it was');
    }

    public function testDeletingTheVerifyingAccountClearsTheVerifierAndKeepsTheEntry(): void
    {
        $this->createAccount('daniel', 'daniels-passwort');
        $this->previousReleaseRecordsAnEntry();
        // Verified by daniel; set directly, as nothing verifies through the API yet.
        $this->otherSession()->exec("UPDATE entries SET verified_at = UTC_TIMESTAMP(3), verified_by_account_id = 2 WHERE id = '" . self::ENTRY . "'");

        $deleted = $this->send('DELETE', '/api/accounts/2', session: $this->signIn());

        self::assertSame(204, $deleted->getStatusCode(), (string) $deleted->getBody());
        self::assertSame([['id' => self::ENTRY, 'verified_by_account_id' => null]], $this->rows('SELECT id, verified_by_account_id FROM entries'));
    }

    public function testTheForeignKeyMigrationRestoresTheSessionsForeignKeyChecksAfterSuccess(): void
    {
        $pdo = $this->migrationSession();
        $migrator = new Migrator($pdo, self::migrations(static fn(string $name): bool => true));

        self::assertSame(MigrationState::Ok, $migrator->migrate());

        self::assertSame(1, self::foreignKeyChecks($pdo));
    }

    public function testTheForeignKeyMigrationRestoresTheSessionsForeignKeyChecksAfterAFailure(): void
    {
        $pdo = $this->migrationSession();
        // Without the columns and their index, the foreign key names a column that does not exist.
        $migrator = new Migrator($pdo, self::migrations(static fn(string $name): bool => !in_array($name, array_slice(self::ENTRY_MIGRATIONS, 0, 2), true)));

        self::assertSame(MigrationState::Failed, $migrator->migrate());

        self::assertSame(1, self::foreignKeyChecks($pdo));
        self::assertSame('failed', array_column($this->rows('SELECT version, state FROM schema_migrations'), 'state', 'version')[self::ENTRY_MIGRATIONS[2]]);
        self::assertSame([], $this->rows("SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = 'entries_verifier'"));
    }

    /** Brings an empty database to the schema of the given migration, as the previous release left it. */
    private function migrateUpTo(string $last): void
    {
        $migrator = new Migrator($this->migrationSession(), self::migrations(static fn(string $name): bool => strcmp($name, $last) <= 0));
        self::assertSame(MigrationState::Ok, $migrator->migrate());
    }

    /** The previous release's catalog writes and entry insert, as far as they touch the database. */
    private function previousReleaseRecordsAnEntry(): void
    {
        $other = $this->otherSession();
        $now = Timestamp::of($this->clock->now());
        $other->prepare('INSERT INTO persons (name, created_at, updated_at) VALUES (?, ?, ?)')->execute(['Daniel', $now, $now]);
        $other->prepare('INSERT INTO drinks (name, points, created_at, updated_at) VALUES (?, ?, ?, ?)')->execute(['Aperol', '2.50', $now, $now]);
        $other->prepare('INSERT INTO entries (id, person_id, drink_id, quantity, account_id, created_at) VALUES (?, 1, 1, 1, NULL, ?)')
            ->execute([self::ENTRY, $now]);
    }

    /**
     * The table's InnoDB id: a table copy or rebuild creates the table anew under a new id.
     */
    private function tableId(string $table): int
    {
        $rows = $this->rows("SELECT TABLE_ID FROM information_schema.INNODB_SYS_TABLES WHERE NAME = CONCAT(DATABASE(), '/{$table}')");
        self::assertCount(1, $rows);

        $id = $rows[0]['TABLE_ID'];
        self::assertIsNumeric($id);

        return (int) $id;
    }

    /**
     * @return list<array<string, mixed>>
     */
    private static function list(mixed $rows): array
    {
        self::assertIsList($rows);

        /** @var list<array<string, mixed>> */
        return $rows;
    }

    private function migrationSession(): PDO
    {
        $pdo = $this->otherSession();
        $pdo->exec('SET SESSION foreign_key_checks = 1');

        return $pdo;
    }

    private static function foreignKeyChecks(PDO $pdo): int
    {
        $statement = $pdo->query('SELECT @@SESSION.foreign_key_checks');
        if ($statement === false) {
            throw new RuntimeException('foreign_key_checks not readable');
        }

        return (int) $statement->fetchColumn();
    }

    /**
     * The API's own migrations whose names pass the filter, loaded afresh.
     *
     * @param callable(string): bool $included
     *
     * @return array<string, Migration>
     */
    private static function migrations(callable $included): array
    {
        $migrations = [];
        foreach (self::migrationNames() as $name) {
            if ($included($name)) {
                $migration = require dirname(__DIR__, 2) . "/migrations/{$name}.php";
                self::assertInstanceOf(Migration::class, $migration);
                $migrations[$name] = $migration;
            }
        }

        return $migrations;
    }
}
