<?php

declare(strict_types=1);

namespace Performance\Tests\Integration;

use PDO;
use Performance\Domain\Migrator;
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
