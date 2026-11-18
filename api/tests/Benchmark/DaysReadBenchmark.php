<?php

declare(strict_types=1);

namespace Performance\Tests\Benchmark;

use DateTimeImmutable;
use DateTimeZone;
use PDO;
use Performance\Domain\Timestamp;
use Performance\Tests\Support\DatabaseTestCase;
use Performance\Tests\Support\TestClock;
use Psr\Http\Server\RequestHandlerInterface;

/**
 * The cost of the days-with-data reads (PRD #70, owner review of PR #82) on a realistic
 * multi-year history: not part of the suites, run on demand into its own database by a
 * database user that may switch the general log on (root locally):
 *
 *     DB_NAME=performance_bench DB_USER=root DB_PASS=root \
 *       vendor/bin/phpunit tests/Benchmark/DaysReadBenchmark.php
 *
 * The history (BENCH_YEARS, default 5, BENCH_ROWS_FACTOR, default 1, multiply it): 12
 * persons, 8 drinks; Friday and Saturday evenings every week and Wednesday every other
 * week, 19:00–01:00 Berlin time, 40 drink entries an evening (one in twenty-five still
 * waiting); Saturday is the game evening with 10 duel matches (Schach, game 1) and 10
 * results each of two points games (Rommé, game 2, and Darts, game 3), 20:00–23:00; the
 * games restart every 13 weeks. Every read is measured through the application's request
 * handler (routing, session, revision, SQL, JSON) as BENCH_CALLS (default 50) calls: a full
 * read without an ETag, a poll with the current ETag (304), and a poll after the data
 * revision changed (a full read again). The table also names the rows the days query read
 * from its tables and indexes and the response's bytes; below it, the `ANALYZE` of the days
 * query the request ran, taken from the general log. Older code answers the
 * windowed paths as it answers any days request (its routes ignore the query), so the
 * same file measures before and after.
 */
final class DaysReadBenchmark extends DatabaseTestCase
{
    private const NOW = '2026-11-17 22:00:00';
    private const WINDOW = 'from=2026-11-01T00%3A00%3A00%2B01%3A00&to=2026-12-01T00%3A00%3A00%2B01%3A00';
    private const PERSONS = 12;
    private const DRINKS = 8;

    private RequestHandlerInterface $handler;
    private string $session;
    private PDO $server;

    public function testMeasuresTheDaysReads(): void
    {
        $this->clock = new TestClock(self::NOW);
        $this->handler = $this->app();
        $this->session = $this->signIn(app: $this->handler);
        $this->server = $this->otherSession();
        $seeded = $this->seed();

        $reads = [
            'drinks month' => '/api/scoreboard/days?' . self::WINDOW,
            'drinks all' => '/api/scoreboard/days?scope=all',
            'duel month' => '/api/games/1/standings/days?' . self::WINDOW,
            'duel all' => '/api/games/1/standings/days?scope=all',
            'points month' => '/api/games/2/standings/days?' . self::WINDOW,
            'points all' => '/api/games/2/standings/days?scope=all',
            'ranking drinks all (context)' => '/api/scoreboard?scope=all',
            'ranking points all (context)' => '/api/games/2/standings?scope=all',
        ];
        $lines = [
            sprintf('History: %s', $seeded),
            '',
            '| read | status | bytes | table rows read | full read median / p95 ms | 304 poll median ms | after a revision change median ms |',
            '|---|---|---|---|---|---|---|',
        ];
        $plans = [];
        foreach ($reads as $name => $path) {
            [$rowsRead, $plan] = str_contains($name, 'context') ? ['–', null] : $this->plan($path);
            $lines[] = $this->measure($name, $path, $rowsRead);
            if ($plan !== null) {
                $plans[] = "{$name}:\n{$plan}";
            }
        }
        $report = implode("\n", [...$lines, '', ...$plans]) . "\n";
        $out = getenv('BENCH_OUT');
        if (is_string($out) && $out !== '') {
            file_put_contents($out, $report);
        }
        fwrite(STDOUT, "\n" . $report);

        self::assertNotSame('', $report);
    }

    private function measure(string $name, string $path, string $rowsRead): string
    {
        $calls = self::setting('BENCH_CALLS', 50);
        $first = $this->timed($path);
        $status = $first['status'];
        $tag = $first['etag'];
        $bytes = strlen($first['body']);

        $full = [];
        $unchanged = [];
        $changed = [];
        for ($i = 0; $i < $calls; ++$i) {
            $full[] = $this->timed($path)['ms'];
            $unchanged[] = $this->timed($path, $tag)['ms'];
            $this->server->exec('UPDATE data_revision SET revision = revision + 1');
            $answer = $this->timed($path, $tag);
            self::assertSame(200, $answer['status']);
            $changed[] = $answer['ms'];
            $tag = $answer['etag'];
        }

        return sprintf(
            '| %s | %d | %s | %s | %.1f / %.1f | %.1f | %.1f |',
            $name,
            $status,
            number_format($bytes),
            $rowsRead,
            self::percentile($full, 0.5),
            self::percentile($full, 0.95),
            self::percentile($unchanged, 0.5),
            self::percentile($changed, 0.5),
        );
    }

    /**
     * The rows the days query of the read takes from its tables and indexes (not from its
     * temporary tables), and its `ANALYZE` (the plan with the rows actually read).
     *
     * @return array{string, string}
     */
    private function plan(string $path): array
    {
        $this->server->exec('TRUNCATE mysql.general_log');
        $this->server->exec("SET GLOBAL log_output = 'TABLE'");
        $this->server->exec('SET GLOBAL general_log = 1');
        $this->timed($path);
        $this->server->exec('SET GLOBAL general_log = 0');
        $statement = $this->server->query(
            "SELECT CONVERT(argument USING utf8mb4) FROM mysql.general_log
             WHERE command_type = 'Execute' AND argument LIKE '%quarter%' ORDER BY event_time DESC LIMIT 1",
        );
        self::assertNotFalse($statement);
        $sql = $statement->fetchColumn();
        self::assertIsString($sql, 'the read ran a days query');
        $json = $this->server->query('ANALYZE FORMAT=JSON ' . $sql);
        self::assertNotFalse($json);
        $rowsRead = self::tableRows(json_decode((string) $json->fetchColumn(), true, flags: JSON_THROW_ON_ERROR));
        $analyze = $this->server->query('ANALYZE ' . $sql);
        self::assertNotFalse($analyze);
        $lines = ['  | id | select_type | table | type | key | rows | r_rows | r_filtered | Extra |', '  |---|---|---|---|---|---|---|---|---|'];
        /** @var array<string, scalar|null> $row */
        foreach ($analyze->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $lines[] = sprintf(
                '  | %s | %s | %s | %s | %s | %s | %s | %s | %s |',
                $row['id'] ?? '',
                $row['select_type'] ?? '',
                $row['table'] ?? '',
                $row['type'] ?? '',
                $row['key'] ?? '',
                $row['rows'] ?? '',
                $row['r_rows'] ?? '',
                $row['r_filtered'] ?? '',
                $row['Extra'] ?? '',
            );
        }

        return [number_format($rowsRead), implode("\n", $lines)];
    }

    /** The rows read from tables (r_loops × r_rows of every table that is not derived) in an `ANALYZE FORMAT=JSON`. */
    private static function tableRows(mixed $node): int
    {
        if (!is_array($node)) {
            return 0;
        }
        $rows = 0;
        $table = $node['table_name'] ?? null;
        if (is_string($table) && !str_starts_with($table, '<') && is_numeric($node['r_loops'] ?? null) && is_numeric($node['r_rows'] ?? null)) {
            $rows += (int) round((float) $node['r_loops'] * (float) $node['r_rows']);
        }
        foreach ($node as $child) {
            $rows += self::tableRows($child);
        }

        return $rows;
    }

    /**
     * @return array{status: int, etag: string, body: string, ms: float}
     */
    private function timed(string $path, ?string $ifNoneMatch = null): array
    {
        $start = hrtime(true);
        $response = $this->send('GET', $path, session: $this->session, app: $this->handler, headers: $ifNoneMatch === null ? [] : ['If-None-Match' => $ifNoneMatch]);
        $body = (string) $response->getBody();
        $ms = (hrtime(true) - $start) / 1e6;

        return ['status' => $response->getStatusCode(), 'etag' => $response->getHeaderLine('ETag'), 'body' => $body, 'ms' => $ms];
    }

    /** Seeds the history and says what it holds. */
    private function seed(): string
    {
        for ($i = 1; $i <= self::PERSONS; ++$i) {
            $this->send('POST', '/api/persons', ['name' => "Person {$i}"], $this->session, $this->handler);
        }
        for ($i = 1; $i <= self::DRINKS; ++$i) {
            $this->send('POST', '/api/drinks', ['name' => "Getränk {$i}", 'points' => $i % 3 + 1], $this->session, $this->handler);
        }
        $this->send('POST', '/api/games', ['name' => 'Schach', 'kind' => 'duel'], $this->session, $this->handler);
        $this->send('POST', '/api/games', ['name' => 'Rommé', 'kind' => 'points', 'lowerWins' => true], $this->session, $this->handler);
        $this->send('POST', '/api/games', ['name' => 'Darts', 'kind' => 'points'], $this->session, $this->handler);

        mt_srand(70);
        $factor = self::setting('BENCH_ROWS_FACTOR', 1);
        $berlin = new DateTimeZone('Europe/Berlin');
        $last = new DateTimeImmutable('2026-11-17', $berlin);
        $first = $last->modify(sprintf('-%d years', self::setting('BENCH_YEARS', 5)));
        $entries = [];
        $matches = [];
        $results = [];
        $evenings = 0;
        $run = 1;
        $sequence = 0;
        for ($day = $first; $day <= $last; $day = $day->modify('+1 day')) {
            $weekday = (int) $day->format('N');
            $week = intdiv((int) $day->diff($first)->days, 7);
            if (!in_array($weekday, [5, 6], true) && !($weekday === 3 && $week % 2 === 0)) {
                continue;
            }
            ++$evenings;
            $run = intdiv($week, 13) + 1;
            $evening = $day->setTime(19, 0);
            for ($i = 0; $i < 40 * $factor; ++$i) {
                $at = self::at($evening, 6 * 3600);
                $entries[] = sprintf("('%s', %d, %d, 1, NULL, '%s', %d)", self::id(++$sequence), mt_rand(1, self::PERSONS), mt_rand(1, self::DRINKS), $at, mt_rand(1, 25) === 1 ? 1 : 0);
            }
            if ($weekday !== 6) {
                continue;
            }
            $games = $day->setTime(20, 0);
            for ($i = 0; $i < 10 * $factor; ++$i) {
                $first_ = mt_rand(1, self::PERSONS);
                $second = $first_ % self::PERSONS + 1;
                $matches[] = sprintf("('%s', 1, %d, %d, '%s', %d, NULL, '%s', 0)", self::id(++$sequence), $first_, $second, ['first', 'second', 'draw'][mt_rand(0, 2)], $run, self::at($games, 3 * 3600));
                foreach ([2, 3] as $game) {
                    $results[] = sprintf("('%s', %d, %d, %d, %d, NULL, '%s', 0)", self::id(++$sequence), $game, mt_rand(1, self::PERSONS), mt_rand(-20, 120), $run, self::at($games, 3 * 3600));
                }
            }
        }
        $this->insert('entries (id, person_id, drink_id, quantity, account_id, created_at, pending)', $entries);
        $this->insert('matches (id, game_id, first_person_id, second_person_id, outcome, run, account_id, created_at, pending)', $matches);
        $this->insert('results (id, game_id, person_id, points, run, account_id, created_at, pending)', $results);
        $this->server->exec("UPDATE games SET run = {$run}");
        $analyzed = $this->server->query('ANALYZE TABLE entries, matches, results');
        self::assertNotFalse($analyzed);
        $analyzed->fetchAll();

        return sprintf(
            '%d evenings over %s years, %s entries, %s matches, %s results (rows factor %d)',
            $evenings,
            self::setting('BENCH_YEARS', 5),
            number_format(count($entries)),
            number_format(count($matches)),
            number_format(count($results)),
            $factor,
        );
    }

    /**
     * @param list<string> $rows
     */
    private function insert(string $table, array $rows): void
    {
        foreach (array_chunk($rows, 2000) as $chunk) {
            $this->server->exec("INSERT INTO {$table} VALUES " . implode(', ', $chunk));
        }
    }

    /** A random instant within `$seconds` after `$start`, as the database stores it (UTC). */
    private static function at(DateTimeImmutable $start, int $seconds): string
    {
        return Timestamp::of($start->modify(sprintf('+%d milliseconds', mt_rand(0, $seconds * 1000 - 1))));
    }

    private static function id(int $sequence): string
    {
        return sprintf('00000000-0000-4000-8000-%012d', $sequence);
    }

    private static function setting(string $name, int $default): int
    {
        $value = getenv($name);

        return is_string($value) && ctype_digit($value) ? (int) $value : $default;
    }

    /**
     * @param list<float> $values
     */
    private static function percentile(array $values, float $share): float
    {
        sort($values);

        return $values[(int) min(count($values) - 1, floor($share * count($values)))];
    }
}
