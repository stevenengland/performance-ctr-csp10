<?php

declare(strict_types=1);

namespace Performance\Tests\Integration;

use PDO;
use PDOException;
use Performance\Http\Database;
use Performance\Tests\Support\DatabaseTestCase;

/**
 * The host's MariaDB leaves `sql_mode` empty, keeps the session time zone at `SYSTEM`
 * and defaults to utf8mb3; CI's database is started the same way. The API's sessions
 * must not depend on any of that.
 */
final class ConnectionTest extends DatabaseTestCase
{
    public function testEverySessionIsStrictUtcAndUtf8mb4WhateverTheServerDefaultsAre(): void
    {
        $settings = $this->query(
            (new Database($this->config(), $this->clock))->pdo(),
            'SELECT @@SESSION.sql_mode AS sql_mode, @@SESSION.time_zone AS time_zone,
                    @@character_set_client AS client, @@character_set_connection AS connection,
                    @@character_set_results AS results, @@collation_connection AS collation',
        );

        self::assertSame([
            'sql_mode' => 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION',
            'time_zone' => '+00:00',
            'client' => 'utf8mb4',
            'connection' => 'utf8mb4',
            'results' => 'utf8mb4',
            'collation' => 'utf8mb4_unicode_ci',
        ], $settings);
    }

    public function testStrictModeRefusesAValueThatANonStrictServerWouldTruncate(): void
    {
        $this->get('/api/health');
        $pdo = Database::open($this->config());

        $this->expectException(PDOException::class);
        $this->expectExceptionMessageMatches('/1406/');
        $pdo->exec(sprintf(
            "INSERT INTO persons (name, created_at, updated_at) VALUES ('%s', '2026-11-14 20:00:00.000', '2026-11-14 20:00:00.000')",
            str_repeat('x', 41),
        ));
    }

    public function testUtcTimestampsSurviveTheRoundTripUnshifted(): void
    {
        $pdo = Database::open($this->config());

        self::assertSame(
            ['utc' => '1', 'stored' => '2026-11-14 20:00:00.000'],
            $this->query($pdo, "SELECT UTC_TIMESTAMP() = NOW() AS utc, CAST('2026-11-14 20:00:00.000' AS DATETIME(3)) AS stored"),
        );
    }

    /**
     * @return array<string, string>
     */
    private function query(PDO $pdo, string $sql): array
    {
        $statement = $pdo->query($sql);
        self::assertNotFalse($statement);
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        self::assertIsArray($row);

        return array_map(static fn(mixed $value): string => is_scalar($value) ? (string) $value : '', $row);
    }
}
