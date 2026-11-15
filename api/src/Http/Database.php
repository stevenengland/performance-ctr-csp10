<?php

declare(strict_types=1);

namespace Performance\Http;

use PDO;
use Performance\Domain\Accounts;
use Performance\Domain\Catalog\Catalog;
use Performance\Domain\Clock;
use Performance\Domain\DataRevision;
use Performance\Domain\EntryLedger;
use Performance\Domain\Migrator;
use Performance\Domain\Scoreboard;
use Performance\Domain\Sessions;

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
    private ?EntryLedger $entries = null;
    private ?Scoreboard $scoreboard = null;
    private ?DataRevision $revision = null;

    public function __construct(
        private readonly Config $config,
        private readonly Clock $clock,
    ) {}

    public function pdo(): PDO
    {
        return $this->pdo ??= $this->connect();
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

    public function catalog(): Catalog
    {
        return $this->catalog ??= new Catalog($this->pdo(), $this->clock, $this->revision());
    }

    public function entries(): EntryLedger
    {
        return $this->entries ??= new EntryLedger($this->pdo(), $this->clock, $this->revision());
    }

    public function scoreboard(): Scoreboard
    {
        return $this->scoreboard ??= new Scoreboard($this->pdo(), $this->revision());
    }

    private function revision(): DataRevision
    {
        return $this->revision ??= new DataRevision($this->pdo());
    }

    private function connect(): PDO
    {
        $pdo = new PDO(
            $this->config->databaseDsn,
            $this->config->databaseUser,
            $this->config->databasePassword,
            [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_EMULATE_PREPARES => false,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            ],
        );
        $pdo->exec("SET time_zone = '+00:00'");

        return $pdo;
    }
}
