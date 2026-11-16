<?php

declare(strict_types=1);

namespace Performance\Http;

use PDO;
use Performance\Domain\Accounts;
use Performance\Domain\AuditLog;
use Performance\Domain\Catalog\Catalog;
use Performance\Domain\Catalog\PersonPhotos;
use Performance\Domain\Clock;
use Performance\Domain\CompositeGameDependents;
use Performance\Domain\CompositePersonDependents;
use Performance\Domain\DataRevision;
use Performance\Domain\EntryLedger;
use Performance\Domain\Games\Games;
use Performance\Domain\Games\Matches;
use Performance\Domain\Games\Results;
use Performance\Domain\Idempotency;
use Performance\Domain\Migrator;
use Performance\Domain\Scoreboard;
use Performance\Domain\Sessions;
use Performance\Domain\Snapshot;

/**
 * Opens the request's database session, and the domain modules that work on it,
 * on first use, so a request that needs no database (and an unreachable
 * database) fails only where it matters.
 */
final class Database
{
    private ?PDO $pdo = null;
    private ?Migrator $migrator = null;
    private ?Accounts $accounts = null;
    private ?Sessions $sessions = null;
    private ?Catalog $catalog = null;
    private ?PersonPhotos $personPhotos = null;
    private ?EntryLedger $entries = null;
    private ?Scoreboard $scoreboard = null;
    private ?DataRevision $revision = null;
    private ?AuditLog $audit = null;
    private ?Idempotency $idempotency = null;
    private ?Games $games = null;
    private ?Matches $matches = null;
    private ?Results $results = null;

    public function __construct(
        private readonly Config $config,
        private readonly Clock $clock,
    ) {}

    public function pdo(): PDO
    {
        return $this->pdo ??= self::open($this->config);
    }

    public function migrator(): Migrator
    {
        return $this->migrator ??= Migrator::fromDirectories($this->pdo(), ...$this->config->migrationDirectories);
    }

    public function accounts(): Accounts
    {
        return $this->accounts ??= new Accounts($this->pdo(), $this->clock);
    }

    public function sessions(): Sessions
    {
        return $this->sessions ??= new Sessions($this->pdo(), $this->accounts(), $this->clock);
    }

    /** The catalog with the dependents of a person: one composite of the modules whose rows name persons (Matches and Results). */
    public function catalog(): Catalog
    {
        return $this->catalog ??= new Catalog($this->pdo(), $this->clock, $this->revision(), $this->audit(), new CompositePersonDependents($this->matches(), $this->results()));
    }

    public function personPhotos(): PersonPhotos
    {
        return $this->personPhotos ??= new PersonPhotos($this->pdo(), $this->clock, $this->revision(), $this->audit());
    }

    public function entries(): EntryLedger
    {
        return $this->entries ??= new EntryLedger($this->pdo(), $this->clock, $this->revision(), $this->audit(), $this->idempotency());
    }

    /** Games with their dependents: one composite of the modules whose rows go with a game (Matches and Results). */
    public function games(): Games
    {
        return $this->games ??= new Games($this->pdo(), $this->clock, $this->revision(), $this->audit(), new CompositeGameDependents($this->matches(), $this->results()));
    }

    public function matches(): Matches
    {
        return $this->matches ??= new Matches($this->pdo(), $this->clock, $this->revision(), $this->audit(), $this->idempotency());
    }

    public function results(): Results
    {
        return $this->results ??= new Results($this->pdo(), $this->clock, $this->revision(), $this->audit(), $this->idempotency());
    }

    public function scoreboard(): Scoreboard
    {
        return $this->scoreboard ??= new Scoreboard($this->pdo(), $this->revision());
    }

    public function audit(): AuditLog
    {
        return $this->audit ??= new AuditLog($this->pdo(), $this->clock);
    }

    /** One consistent view of the committed data for several reads, e.g. a ranking with its revision. */
    public function snapshot(): Snapshot
    {
        return new Snapshot($this->pdo());
    }

    public function revision(): DataRevision
    {
        return $this->revision ??= new DataRevision($this->pdo());
    }

    private function idempotency(): Idempotency
    {
        return $this->idempotency ??= new Idempotency($this->pdo(), $this->revision());
    }

    /**
     * The session settings the API relies on, set on every connection because the host's
     * MariaDB does not: its `sql_mode` is empty (it would truncate an overlong value instead
     * of refusing it), its session time zone is `SYSTEM` and its default charset utf8mb3.
     * The collation is the tables' own, so literals and parameters never mix collations.
     */
    public const SESSION_SETUP = "SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci,
        SESSION sql_mode = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION',
        SESSION time_zone = '+00:00'";

    /**
     * Opens a database session with the API's settings: exceptions, native prepared
     * statements, and the session setup above in one round trip.
     */
    public static function open(Config $config): PDO
    {
        $pdo = new PDO(
            $config->databaseDsn,
            $config->databaseUser,
            $config->databasePassword,
            [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_EMULATE_PREPARES => false,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            ],
        );
        $pdo->exec(self::SESSION_SETUP);

        return $pdo;
    }
}
