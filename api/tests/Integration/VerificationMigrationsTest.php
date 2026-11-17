<?php

declare(strict_types=1);

namespace Performance\Tests\Integration;

use PDO;
use Performance\Domain\Migration;
use Performance\Domain\MigrationState;
use Performance\Domain\Migrator;
use Performance\Domain\Timestamp;
use Performance\Tests\Support\DatabaseTestCase;
use PHPUnit\Framework\Attributes\DataProvider;
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
    /** Each row table's migrations: its columns, its pending index, its verifier foreign key. */
    private const MIGRATIONS = [
        'entries' => ['0020_add_entries_verification', '0021_add_entries_pending_index', '0022_add_entries_verifier_foreign_key'],
        'matches' => ['0024_add_matches_verification', '0025_add_matches_pending_index', '0026_add_matches_verifier_foreign_key'],
        'results' => ['0027_add_results_verification', '0028_add_results_pending_index', '0029_add_results_verifier_foreign_key'],
    ];
    private const ROW = '6f1c2d3e-4a5b-4c6d-8e7f-90a1b2c3d4e5';

    /**
     * @return iterable<string, array{'entries'|'matches'|'results'}>
     */
    public static function tables(): iterable
    {
        foreach (array_keys(self::MIGRATIONS) as $table) {
            yield $table => [$table];
        }
    }

    /**
     * @param 'entries'|'matches'|'results' $table
     */
    #[DataProvider('tables')]
    public function testTheUpgradeKeepsEveryRowCountingWithoutCopyingTheTable(string $table): void
    {
        $this->migrateUpTo(self::PREVIOUS_SCHEMA);
        $this->previousReleaseRecords($table);
        $tableId = $this->tableId($table);

        $health = $this->body($this->get('/api/health'));

        self::assertSame('ok', $health['migration']);
        self::assertSame($tableId, $this->tableId($table), 'the table was neither copied nor rebuilt');
        self::assertSame(self::COUNTED[$table], $this->firstRanked($table), 'the row from before counts');
    }

    /**
     * @param 'entries'|'matches'|'results' $table
     */
    #[DataProvider('tables')]
    public function testEachMigrationRunsAgainAfterACrashBeforeItsBookkeepingWithoutChangingAnything(string $table): void
    {
        $this->get('/api/health');
        $this->previousReleaseRecords($table);
        // A crash between each DDL and its bookkeeping: the change is in, the rows say started.
        $this->otherSession()->exec(
            "UPDATE schema_migrations SET state = 'started', completed_at = NULL WHERE version IN ('" . implode("', '", self::MIGRATIONS[$table]) . "')",
        );

        $health = $this->body($this->get('/api/health'));

        self::assertSame('ok', $health['migration']);
        $states = array_column($this->rows('SELECT version, state FROM schema_migrations'), 'state', 'version');
        foreach (self::MIGRATIONS[$table] as $name) {
            self::assertSame('completed', $states[$name], $name);
        }
        self::assertSame([['id' => self::ROW]], $this->rows("SELECT id FROM {$table}"), 'the table is kept as it was');
    }

    /**
     * @param 'entries'|'matches'|'results' $table
     */
    #[DataProvider('tables')]
    public function testDeletingTheVerifyingAccountClearsTheVerifierAndKeepsTheRow(string $table): void
    {
        $this->createAccount('daniel', 'daniels-passwort');
        $this->previousReleaseRecords($table);
        // Verified by daniel; set directly, as the previous release left the row counting already.
        $this->otherSession()->exec("UPDATE {$table} SET verified_at = UTC_TIMESTAMP(3), verified_by_account_id = 2 WHERE id = '" . self::ROW . "'");

        $deleted = $this->send('DELETE', '/api/accounts/2', session: $this->signIn());

        self::assertSame(204, $deleted->getStatusCode(), (string) $deleted->getBody());
        self::assertSame([['id' => self::ROW, 'verified_by_account_id' => null]], $this->rows("SELECT id, verified_by_account_id FROM {$table}"));
    }

    /**
     * @param 'entries'|'matches'|'results' $table
     */
    #[DataProvider('tables')]
    public function testTheForeignKeyMigrationSetsAVerifierThatNamesNoAccountToNull(string $table): void
    {
        $this->migrateUpTo(self::MIGRATIONS[$table][1]);
        $this->previousReleaseRecords($table);
        // A verifier written before the key existed, naming an account that never existed.
        $this->otherSession()->exec("UPDATE {$table} SET verified_at = UTC_TIMESTAMP(3), verified_by_account_id = 999 WHERE id = '" . self::ROW . "'");

        $health = $this->body($this->get('/api/health'));

        self::assertSame('ok', $health['migration']);
        self::assertSame([['id' => self::ROW, 'verified_by_account_id' => null]], $this->rows("SELECT id, verified_by_account_id FROM {$table}"));
        self::assertCount(1, $this->rows("SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = '{$table}_verifier'"));
    }

    /**
     * @param 'entries'|'matches'|'results' $table
     */
    #[DataProvider('tables')]
    public function testTheForeignKeyMigrationValidatesAgainAfterACrashBetweenTheKeyAndTheValidation(string $table): void
    {
        $this->get('/api/health');
        $this->previousReleaseRecords($table);
        // The key is in, the orphan was never cleared, the bookkeeping still says started.
        $other = $this->otherSession();
        $other->exec('SET SESSION foreign_key_checks = 0');
        $other->exec("UPDATE {$table} SET verified_by_account_id = 999 WHERE id = '" . self::ROW . "'");
        $other->exec("UPDATE schema_migrations SET state = 'started', completed_at = NULL WHERE version = '" . self::MIGRATIONS[$table][2] . "'");

        $health = $this->body($this->get('/api/health'));

        self::assertSame('ok', $health['migration']);
        self::assertSame('completed', array_column($this->rows('SELECT version, state FROM schema_migrations'), 'state', 'version')[self::MIGRATIONS[$table][2]]);
        self::assertSame([['id' => self::ROW, 'verified_by_account_id' => null]], $this->rows("SELECT id, verified_by_account_id FROM {$table}"));
    }

    public function testTheForeignKeyMigrationsRestoreTheSessionsForeignKeyChecksAfterSuccess(): void
    {
        $pdo = $this->migrationSession();
        $migrator = new Migrator($pdo, self::migrations(static fn(string $name): bool => true));

        self::assertSame(MigrationState::Ok, $migrator->migrate());

        self::assertSame(1, self::foreignKeyChecks($pdo));
    }

    /**
     * @param 'entries'|'matches'|'results' $table
     */
    #[DataProvider('tables')]
    public function testTheForeignKeyMigrationRestoresTheSessionsForeignKeyChecksAfterAFailure(string $table): void
    {
        $pdo = $this->migrationSession();
        // Without the columns and their index, the foreign key names a column that does not exist.
        $skipped = array_slice(self::MIGRATIONS[$table], 0, 2);
        $migrator = new Migrator($pdo, self::migrations(static fn(string $name): bool => !in_array($name, $skipped, true)));

        self::assertSame(MigrationState::Failed, $migrator->migrate());

        self::assertSame(1, self::foreignKeyChecks($pdo));
        self::assertSame('failed', array_column($this->rows('SELECT version, state FROM schema_migrations'), 'state', 'version')[self::MIGRATIONS[$table][2]]);
        self::assertSame([], $this->rows("SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = '{$table}_verifier'"));
    }

    /** Brings an empty database to the schema of the given migration, as the previous release left it. */
    private function migrateUpTo(string $last): void
    {
        $migrator = new Migrator($this->migrationSession(), self::migrations(static fn(string $name): bool => strcmp($name, $last) <= 0));
        self::assertSame(MigrationState::Ok, $migrator->migrate());
    }

    /** What the first ranked row of each table's ranking shows of the row the previous release recorded. */
    private const COUNTED = [
        'entries' => ['personId' => 1, 'name' => 'Daniel', 'score' => 2.5, 'count' => 1],
        'matches' => ['personId' => 1, 'name' => 'Daniel', 'points' => 1, 'played' => 1],
        'results' => ['personId' => 1, 'name' => 'Daniel', 'sum' => 7, 'results' => 1],
    ];

    /**
     * The previous release's catalog writes and its insert of an entry, a match or a result, as far as
     * they touch the database.
     *
     * @param 'entries'|'matches'|'results' $table
     */
    private function previousReleaseRecords(string $table): void
    {
        $other = $this->otherSession();
        $now = Timestamp::of($this->clock->now());
        foreach (['Daniel', 'Anna'] as $name) {
            $other->prepare('INSERT INTO persons (name, created_at, updated_at) VALUES (?, ?, ?)')->execute([$name, $now, $now]);
        }
        if ($table === 'entries') {
            $other->prepare('INSERT INTO drinks (name, points, created_at, updated_at) VALUES (?, ?, ?, ?)')->execute(['Aperol', '2.50', $now, $now]);
            $other->prepare('INSERT INTO entries (id, person_id, drink_id, quantity, account_id, created_at) VALUES (?, 1, 1, 1, NULL, ?)')
                ->execute([self::ROW, $now]);

            return;
        }
        if ($table === 'results') {
            $other->prepare("INSERT INTO games (name, kind, draws_allowed, lower_wins, run, started_at, created_at) VALUES ('Wizard', 'points', 0, 0, 1, ?, ?)")
                ->execute([$now, $now]);
            $other->prepare('INSERT INTO results (id, game_id, person_id, points, run, account_id, created_at) VALUES (?, 1, 1, 7, 1, NULL, ?)')
                ->execute([self::ROW, $now]);

            return;
        }
        $other->prepare("INSERT INTO games (name, kind, draws_allowed, lower_wins, run, started_at, created_at) VALUES ('Schach', 'duel', 1, 0, 1, ?, ?)")
            ->execute([$now, $now]);
        $other->prepare("INSERT INTO matches (id, game_id, first_person_id, second_person_id, outcome, run, account_id, created_at) VALUES (?, 1, 1, 2, 'first', 1, NULL, ?)")
            ->execute([self::ROW, $now]);
    }

    /**
     * The first ranked row of the table's ranking: today's Rangliste, or Schach's or Wizard's standings.
     *
     * @param 'entries'|'matches'|'results' $table
     *
     * @return array<string, mixed>
     */
    private function firstRanked(string $table): array
    {
        $path = $table === 'entries' ? '/api/scoreboard?from=2026-11-14T00:00:00Z' : '/api/games/1/standings';
        $first = self::list($this->body($this->send('GET', $path, session: $this->signIn()))['rows'])[0];

        return array_intersect_key($first, self::COUNTED[$table]);
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
