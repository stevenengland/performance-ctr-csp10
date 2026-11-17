<?php

declare(strict_types=1);

namespace Performance\Tests\Integration;

use PDO;
use Performance\Domain\MigrationState;
use Performance\Domain\Migrator;
use Performance\Http\Database;
use Performance\Tests\Support\DatabaseTestCase;

final class MigratorTest extends DatabaseTestCase
{
    public function testTheFirstRequestOnAnEmptyDatabaseAppliesEveryMigrationUnderTheLockRecordingStartedAndCompleted(): void
    {
        $app = $this->app($this->config($this->fixtureMigrations('lock-probe')));

        $health = $this->body($this->get('/api/health', $app));

        self::assertSame('ok', $health['migration']);
        self::assertSame(9001, $health['schemaVersion']);
        $rows = $this->bookkeeping();
        self::assertSame([...self::migrationNames(), '9001_require_the_lock'], array_column($rows, 'version'));
        foreach ($rows as $row) {
            self::assertSame('completed', $row['state']);
            self::assertNotNull($row['started_at']);
            self::assertNotNull($row['completed_at']);
        }
    }

    public function testARequestArrivingWhileAnotherSessionMigratesGets503WithRetryAfter(): void
    {
        $other = $this->otherSession();
        $lock = $other->prepare('SELECT GET_LOCK(?, 0)');
        $lock->execute([Migrator::lockName($other)]);

        $response = $this->get('/api/anything');

        self::assertSame(503, $response->getStatusCode());
        self::assertSame('application/problem+json', $response->getHeaderLine('Content-Type'));
        self::assertSame('5', $response->getHeaderLine('Retry-After'));
        self::assertSame('urn:performance:problem:maintenance', $this->body($response)['type']);
        $health = $this->body($this->get('/api/health'));
        self::assertSame('running', $health['migration']);
        self::assertSame(0, $health['schemaVersion']);
    }

    /**
     * The cutover barrier of a release (runbook, "What a push to `main` does"): its code writes
     * nothing before its migrations completed. A verification and a recording that arrive
     * while another session migrates answer 503 and change nothing; once the migrations
     * completed, the same requests go through.
     */
    public function testAWriteArrivingWhileAnotherSessionMigratesGets503AndChangesNothingUntilTheMigrationsCompleted(): void
    {
        $admin = $this->signIn();
        $this->createAccount('anna', 'annas-startpasswort');
        $anna = $this->signIn('anna', 'annas-startpasswort');
        $this->send('POST', '/api/persons', ['name' => 'Daniel'], $admin);
        $this->send('POST', '/api/drinks', ['name' => 'Bier', 'points' => 1], $admin);
        $waiting = '00000000-0000-4000-8000-000000000001';
        $recording = '00000000-0000-4000-8000-000000000002';
        $entry = ['personId' => 1, 'drinkId' => 1, 'quantity' => 1];
        self::assertSame(201, $this->send('PUT', "/api/entries/{$waiting}", $entry, $admin)->getStatusCode());
        $next = $this->app($this->config($this->fixtureMigrations('lock-probe')));
        $other = $this->otherSession();
        $lock = $other->prepare('SELECT GET_LOCK(?, 0)');
        $lock->execute([Migrator::lockName($other)]);

        $verified = $this->send('PUT', "/api/entries/{$waiting}/verification", [], $anna, $next);
        $recorded = $this->send('PUT', "/api/entries/{$recording}", $entry, $anna, $next);

        foreach ([$verified, $recorded] as $response) {
            self::assertSame(503, $response->getStatusCode());
            self::assertSame('urn:performance:problem:maintenance', $this->body($response)['type']);
        }
        self::assertSame(
            [['id' => $waiting, 'pending' => 1, 'verified_by_account_id' => null]],
            $this->rows('SELECT id, pending, verified_by_account_id FROM entries'),
        );

        $other->prepare('SELECT RELEASE_LOCK(?)')->execute([Migrator::lockName($other)]);

        self::assertSame(204, $this->send('PUT', "/api/entries/{$waiting}/verification", [], $anna, $next)->getStatusCode());
        self::assertSame(201, $this->send('PUT', "/api/entries/{$recording}", $entry, $anna, $next)->getStatusCode());
    }

    public function testAMigrationWhoseDdlRanButWasNeverRecordedCompletesOnTheNextRun(): void
    {
        $this->get('/api/health');
        $other = $this->otherSession();
        // A crash between the DDL and its bookkeeping: the table exists, the row says started.
        $other->exec('CREATE TABLE crash_probe (id INT UNSIGNED NOT NULL PRIMARY KEY)');
        $other->exec(
            "INSERT INTO schema_migrations (version, state, started_at) VALUES ('9001_create_crash_probe', 'started', UTC_TIMESTAMP(3))",
        );

        $health = $this->body($this->get('/api/health', $this->app($this->config($this->fixtureMigrations('crash')))));

        self::assertSame('ok', $health['migration']);
        self::assertSame(9001, $health['schemaVersion']);
        self::assertSame('completed', array_column($this->bookkeeping(), 'state', 'version')['9001_create_crash_probe']);
    }

    public function testAFailingMigrationLeavesHealthReportingFailedAndTheApiAnswering503(): void
    {
        $app = $this->app($this->config($this->fixtureMigrations('failing')));

        $health = $this->body($this->get('/api/health', $app));
        $other = $this->get('/api/anything', $app);

        self::assertSame('failed', $health['migration']);
        self::assertSame(self::schemaVersion(), $health['schemaVersion']);
        self::assertSame(503, $other->getStatusCode());
        self::assertSame('application/problem+json', $other->getHeaderLine('Content-Type'));
        self::assertSame('urn:performance:problem:migration-failed', $this->body($other)['type']);
    }

    public function testAfterAFailureOtherRequestsRetryTheMigrationAtMostOncePerBackoffWhileHealthRetriesAtOnce(): void
    {
        $app = $this->app($this->config($this->fixtureMigrations('failing')));
        $this->get('/api/health', $app);
        $failedAgo = fn(int $seconds) => $this->otherSession()->exec(
            "UPDATE schema_migrations SET started_at = UTC_TIMESTAMP(3) - INTERVAL {$seconds} SECOND WHERE version = '9001_break_on_purpose'",
        );
        $lastAttempt = fn(): string => (string) array_column($this->bookkeeping(), 'started_at', 'version')['9001_break_on_purpose'];

        $failedAgo(10);
        $before = $lastAttempt();
        $polled = $this->get('/api/anything', $app);
        self::assertSame(503, $polled->getStatusCode());
        self::assertSame('urn:performance:problem:migration-failed', $this->body($polled)['type']);
        self::assertSame($before, $lastAttempt(), 'within the backoff, a request does not run the failing DDL again');

        $this->get('/api/health', $app);
        self::assertNotSame($before, $lastAttempt(), 'health retries at once, so a corrected deploy recovers without waiting');

        $failedAgo(Migrator::FAILED_RETRY_SECONDS + 1);
        $before = $lastAttempt();
        $this->get('/api/anything', $app);
        self::assertNotSame($before, $lastAttempt(), 'after the backoff, the next request retries');
    }

    /**
     * Request-triggered DDL holds the migration lock, so its wait for a table that an open
     * transaction uses is bounded: it gives up, the gate stays `running` (503 with Retry-After,
     * the deploy keeps polling health), nothing is recorded as failed, and a later request
     * applies it once the transaction ended.
     */
    public function testADdlThatWaitsForATableInUseGivesUpAfterTheBoundAndALaterRequestAppliesIt(): void
    {
        $this->get('/api/health');
        $app = $this->app($this->config($this->fixtureMigrations('table-lock')));
        $reader = $this->otherSession();
        $reader->beginTransaction();
        $read = $reader->prepare('SELECT COUNT(*) FROM accounts');
        $read->execute();
        $read->fetchAll();

        $started = microtime(true);
        $health = $this->body($this->get('/api/health', $app));
        $waited = microtime(true) - $started;

        self::assertSame('running', $health['migration']);
        self::assertGreaterThanOrEqual(Migrator::TABLE_LOCK_WAIT_SECONDS - 1, $waited);
        self::assertLessThan(Migrator::TABLE_LOCK_WAIT_SECONDS + 5, $waited, 'bounded, not lock_wait_timeout (a day)');
        self::assertSame('started', array_column($this->bookkeeping(), 'state', 'version')['9001_add_accounts_lock_probe']);
        $probe = $this->otherSession()->prepare('SELECT IS_FREE_LOCK(?)');
        $probe->execute([Migrator::lockName($reader)]);
        self::assertSame(1, (int) $probe->fetchColumn(), 'the migration lock is released');

        $reader->commit();
        $next = $this->get('/api/anything', $app);

        self::assertSame(404, $next->getStatusCode(), 'past the gate');
        self::assertSame('completed', array_column($this->bookkeeping(), 'state', 'version')['9001_add_accounts_lock_probe']);
    }

    /** The bound applies to the migration only: the request goes on with the session's own setting. */
    public function testTheMigrationRestoresTheSessionsLockWaitTimeout(): void
    {
        $config = $this->config($this->fixtureMigrations('table-lock'));
        $database = new Database($config, $this->clock);
        $timeout = $database->pdo()->prepare('SELECT @@SESSION.lock_wait_timeout');
        $timeout->execute();
        $before = $timeout->fetchColumn();

        self::assertSame(MigrationState::Ok, $database->migrator()->migrate());

        $timeout->execute();
        self::assertSame($before, $timeout->fetchColumn());
    }

    public function testRunningAgainIsHarmless(): void
    {
        $this->get('/api/health');

        $health = $this->body($this->get('/api/health'));

        self::assertSame('ok', $health['migration']);
        self::assertSame(self::migrationNames(), array_column($this->bookkeeping(), 'version'));
    }

    public function testTheIdempotencyKeysTableRunsAgainAfterACrashBeforeItsBookkeepingWithoutChangingIt(): void
    {
        $this->get('/api/health');
        $other = $this->otherSession();
        $other->exec("INSERT INTO idempotency_keys (id, fingerprint, created_at) VALUES ('6f1c2d3e-4a5b-4c6d-8e7f-90a1b2c3d4e5', REPEAT('a', 64), UTC_TIMESTAMP(3))");
        // A crash between the DDL and its bookkeeping: the table exists, the row says started.
        $other->exec("UPDATE schema_migrations SET state = 'started', completed_at = NULL WHERE version = '0014_create_idempotency_keys'");

        $health = $this->body($this->get('/api/health'));

        self::assertSame('ok', $health['migration']);
        self::assertSame('completed', array_column($this->bookkeeping(), 'state', 'version')['0014_create_idempotency_keys']);
        self::assertCount(1, $this->rows('SELECT id FROM idempotency_keys'), 'the table is kept as it was');
        self::assertCount(0, $this->rows('SELECT id FROM entry_requests'), 'the previous release still has its table (ADR 0006)');
    }

    public function testTheGamesMigrationsRunAgainAfterACrashBeforeTheirBookkeepingWithoutChangingAnything(): void
    {
        $this->get('/api/health');
        $other = $this->otherSession();
        $other->exec("INSERT INTO games (name, kind, started_at, created_at) VALUES ('Schach', 'duel', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))");
        // A crash between the DDL and its bookkeeping: the change is in, the rows say started.
        $other->exec(
            "UPDATE schema_migrations SET state = 'started', completed_at = NULL
              WHERE version IN ('0015_create_games', '0016_drop_audit_events_subject_kind_check')",
        );

        $health = $this->body($this->get('/api/health'));

        self::assertSame('ok', $health['migration']);
        $states = array_column($this->bookkeeping(), 'state', 'version');
        self::assertSame('completed', $states['0015_create_games']);
        self::assertSame('completed', $states['0016_drop_audit_events_subject_kind_check']);
        self::assertSame([['name' => 'Schach', 'run' => '1']], $this->rows('SELECT name, CAST(run AS CHAR) AS run FROM games'), 'the table is kept as it was');
    }

    public function testTheAuditOperationCheckDropRunsAgainAfterACrashBeforeItsBookkeeping(): void
    {
        $this->get('/api/health');
        // A crash between the DDL and its bookkeeping: the check is gone, the row says started.
        $this->otherSession()->exec(
            "UPDATE schema_migrations SET state = 'started', completed_at = NULL WHERE version = '0023_drop_audit_events_operation_check'",
        );

        $health = $this->body($this->get('/api/health'));

        self::assertSame('ok', $health['migration']);
        self::assertSame('completed', array_column($this->bookkeeping(), 'state', 'version')['0023_drop_audit_events_operation_check']);
    }

    public function testTheMatchesMigrationRunsAgainAfterACrashBeforeItsBookkeepingWithoutChangingAnything(): void
    {
        $this->get('/api/health');
        $other = $this->otherSession();
        $other->exec("INSERT INTO games (name, kind, started_at, created_at) VALUES ('Schach', 'duel', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))");
        $other->exec("INSERT INTO matches (id, game_id, outcome, run, created_at) VALUES ('6f1c2d3e-4a5b-4c6d-8e7f-90a1b2c3d4e5', 1, 'draw', 1, UTC_TIMESTAMP(3))");
        // A crash between the DDL and its bookkeeping: the table exists, the row says started.
        $other->exec("UPDATE schema_migrations SET state = 'started', completed_at = NULL WHERE version = '0017_create_matches'");

        $health = $this->body($this->get('/api/health'));

        self::assertSame('ok', $health['migration']);
        self::assertSame('completed', array_column($this->bookkeeping(), 'state', 'version')['0017_create_matches']);
        self::assertSame([['outcome' => 'draw']], $this->rows('SELECT outcome FROM matches'), 'the table is kept as it was');
    }

    public function testTheResultsMigrationRunsAgainAfterACrashBeforeItsBookkeepingWithoutChangingAnything(): void
    {
        $this->get('/api/health');
        $other = $this->otherSession();
        $other->exec("INSERT INTO games (name, kind, started_at, created_at) VALUES ('Rommé', 'points', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))");
        $other->exec("INSERT INTO persons (name, created_at, updated_at) VALUES ('Daniel', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))");
        $other->exec("INSERT INTO results (id, game_id, person_id, points, run, created_at) VALUES ('6f1c2d3e-4a5b-4c6d-8e7f-90a1b2c3d4e5', 1, 1, -20, 1, UTC_TIMESTAMP(3))");
        // A crash between the DDL and its bookkeeping: the table exists, the row says started.
        $other->exec("UPDATE schema_migrations SET state = 'started', completed_at = NULL WHERE version = '0018_create_results'");

        $health = $this->body($this->get('/api/health'));

        self::assertSame('ok', $health['migration']);
        self::assertSame('completed', array_column($this->bookkeeping(), 'state', 'version')['0018_create_results']);
        self::assertSame([['points' => '-20']], $this->rows('SELECT CAST(points AS CHAR) AS points FROM results'), 'the table is kept as it was');
    }

    public function testThePersonPhotosMigrationRunsAgainAfterACrashBeforeItsBookkeepingWithoutChangingAnything(): void
    {
        $this->get('/api/health');
        $other = $this->otherSession();
        $other->exec("INSERT INTO persons (name, created_at, updated_at) VALUES ('Daniel', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))");
        $other->exec("INSERT INTO person_photos (person_id, jpeg, version, updated_at) VALUES (1, 'jpeg', REPEAT('a', 64), UTC_TIMESTAMP(3))");
        // A crash between the DDL and its bookkeeping: the table exists, the row says started.
        $other->exec("UPDATE schema_migrations SET state = 'started', completed_at = NULL WHERE version = '0019_create_person_photos'");

        $health = $this->body($this->get('/api/health'));

        self::assertSame('ok', $health['migration']);
        self::assertSame('completed', array_column($this->bookkeeping(), 'state', 'version')['0019_create_person_photos']);
        self::assertSame([['jpeg' => 'jpeg']], $this->rows('SELECT jpeg FROM person_photos'), 'the table is kept as it was');
    }

    public function testNoTwoMigrationsShareANumber(): void
    {
        $numbers = array_map(static fn(string $name): string => substr($name, 0, 4), self::migrationNames());

        self::assertSame(array_values(array_unique($numbers)), $numbers, 'two branches took the same migration number; renumber the later one');
    }

    /**
     * @return list<array{version: string, state: string, started_at: ?string, completed_at: ?string}>
     */
    private function bookkeeping(): array
    {
        $statement = $this->otherSession()->query(
            'SELECT version, state, started_at, completed_at FROM schema_migrations ORDER BY version',
        );
        self::assertNotFalse($statement);

        /** @var list<array{version: string, state: string, started_at: ?string, completed_at: ?string}> */
        return $statement->fetchAll(PDO::FETCH_ASSOC);
    }
}
