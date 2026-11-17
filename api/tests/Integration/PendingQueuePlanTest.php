<?php

declare(strict_types=1);

namespace Performance\Tests\Integration;

use PDO;
use Performance\Http\Database;
use Performance\Tests\Support\DatabaseTestCase;
use Performance\Tests\Support\RecordingStatement;

/**
 * The pending queue's reads on production-shaped data (PRD #61): many verified rows of every
 * kind, a fifth of them waiting, most of those recorded by the reading account, ten rows per
 * instant. Every page read (first page and a cursor page) and every count must go through its
 * table's pending index and never scan the whole table. Asserted on the plan's access path and
 * key, not on its row estimates, so the pinned MariaDB of CI proves it as well.
 */
final class PendingQueuePlanTest extends DatabaseTestCase
{
    private const VERIFIED = 4000;
    private const PENDING = 1000;
    private const READER = 1;
    /** The row tables under the alias their queries give them. */
    private const ALIASES = ['entries' => 'e', 'matches' => 'm', 'results' => 'r'];

    private Database $database;

    protected function setUp(): void
    {
        parent::setUp();
        $this->database = new Database($this->config(), $this->clock);
        $this->database->migrator()->migrate();
        $this->seed($this->database->pdo());
    }

    protected function tearDown(): void
    {
        RecordingStatement::$executed = [];
        parent::tearDown();
    }

    public function testEveryPageAndCountOfTheQueueReadsThePendingIndexOfItsTable(): void
    {
        $pdo = $this->database->pdo();
        $pdo->setAttribute(PDO::ATTR_STATEMENT_CLASS, [RecordingStatement::class, []]);
        $first = $this->database->verification()->queue(self::READER, null);
        self::assertNotNull($first->next);
        $this->database->verification()->queue(self::READER, $first->next);
        $pdo->setAttribute(PDO::ATTR_STATEMENT_CLASS, ['PDOStatement']);

        $reads = array_values(array_filter(
            RecordingStatement::$executed,
            static fn(array $statement): bool => str_contains($statement[0], '.pending = 1'),
        ));

        self::assertCount(12, $reads, 'two pages and two counts per kind');
        $seen = [];
        foreach ($reads as [$sql, $parameters]) {
            $explain = $pdo->prepare('EXPLAIN FORMAT=JSON ' . $sql);
            $explain->execute($parameters);
            $plan = json_decode((string) $explain->fetchColumn(), true);
            self::assertIsArray($plan);
            foreach (self::ALIASES as $table => $alias) {
                $access = self::accessOf($plan, $alias);
                if ($access === null) {
                    continue;
                }
                $seen[] = $table;
                self::assertSame("{$table}_pending", $access['key'] ?? null, "{$sql}\n" . json_encode($plan, JSON_PRETTY_PRINT));
                self::assertContains($access['access_type'] ?? null, ['ref', 'range'], "{$sql}\n" . json_encode($plan, JSON_PRETTY_PRINT));
            }
        }
        self::assertSame(['entries' => 4, 'matches' => 4, 'results' => 4], array_count_values($seen));
    }

    /**
     * How the plan reads the table under the alias, if it reads it at all.
     *
     * @param array<mixed> $node
     *
     * @return array<mixed>|null
     */
    private static function accessOf(array $node, string $alias): ?array
    {
        if (($node['table_name'] ?? null) === $alias && isset($node['access_type'])) {
            return $node;
        }
        foreach ($node as $child) {
            if (is_array($child)) {
                $found = self::accessOf($child, $alias);
                if ($found !== null) {
                    return $found;
                }
            }
        }

        return null;
    }

    /**
     * Two accounts, a catalog of a usual size, and per kind VERIFIED verified and PENDING
     * pending rows: four in five pending rows by the reader, ten rows per instant.
     */
    private function seed(PDO $pdo): void
    {
        $now = "'2026-11-01 12:00:00.000'";
        $pdo->exec("INSERT INTO accounts (id, user_name, password_hash, is_admin, created_at, updated_at)
            VALUES (1, 'leser', 'x', 1, {$now}, {$now}), (2, 'anderes', 'x', 0, {$now}, {$now})");
        $pdo->exec('INSERT INTO persons (id, name, created_at, updated_at) VALUES '
            . implode(',', array_map(static fn(int $i): string => "({$i}, 'P{$i}', {$now}, {$now})", range(1, 20))));
        $pdo->exec('INSERT INTO drinks (id, name, points, created_at, updated_at) VALUES '
            . implode(',', array_map(static fn(int $i): string => "({$i}, 'D{$i}', 1, {$now}, {$now})", range(1, 15))));
        $pdo->exec('INSERT INTO games (id, name, kind, run, started_at, created_at) VALUES '
            . implode(',', array_map(static fn(int $i): string => sprintf("(%d, 'G%d', '%s', 1, %s, %s)", $i, $i, $i % 2 === 1 ? 'duel' : 'points', $now, $now), range(1, 8))));
        $columns = [
            'entries' => 'id, person_id, drink_id, quantity, account_id, created_at, pending',
            'matches' => 'id, game_id, first_person_id, second_person_id, outcome, run, account_id, created_at, pending',
            'results' => 'id, game_id, person_id, points, run, account_id, created_at, pending',
        ];
        foreach (array_keys(self::ALIASES) as $k => $table) {
            $rows = [];
            for ($n = 0; $n < self::VERIFIED + self::PENDING; ++$n) {
                $pending = $n >= self::VERIFIED ? 1 : 0;
                $account = $pending === 1 && $n % 5 !== 0 ? self::READER : 2;
                $at = sprintf("'%s.000'", gmdate('Y-m-d H:i:s', 1_790_000_000 + intdiv($n, 10)));
                $id = sprintf("'00000000-0000-4000-800%d-%012d'", $k, $n);
                $rows[] = match ($table) {
                    'entries' => sprintf('(%s, %d, %d, 1, %d, %s, %d)', $id, $n % 20 + 1, $n % 15 + 1, $account, $at, $pending),
                    'matches' => sprintf("(%s, %d, %d, %d, 'first', 1, %d, %s, %d)", $id, ($n % 4) * 2 + 1, $n % 20 + 1, ($n + 1) % 20 + 1, $account, $at, $pending),
                    default => sprintf('(%s, %d, %d, 10, 1, %d, %s, %d)', $id, ($n % 4) * 2 + 2, $n % 20 + 1, $account, $at, $pending),
                };
                if (count($rows) === 1000) {
                    $pdo->exec("INSERT INTO {$table} ({$columns[$table]}) VALUES " . implode(',', $rows));
                    $rows = [];
                }
            }
            $analyzed = $pdo->query("ANALYZE TABLE {$table}");
            self::assertNotFalse($analyzed);
            $analyzed->fetchAll();
        }
    }
}
