<?php

declare(strict_types=1);

namespace Performance\Http;

use PDO;
use Performance\Domain\Migrator;

/**
 * Opens the request's database session on first use, so a request that needs
 * no database (and an unreachable database) fails only where it matters.
 */
final class Database
{
    private ?PDO $pdo = null;
    private ?Migrator $migrator = null;

    public function __construct(private readonly Config $config) {}

    public function pdo(): PDO
    {
        return $this->pdo ??= $this->connect();
    }

    public function migrator(): Migrator
    {
        return $this->migrator ??= Migrator::fromDirectories($this->pdo(), ...$this->config->migrationDirectories);
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
