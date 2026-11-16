<?php

declare(strict_types=1);

namespace Performance\Tests\Integration;

use Performance\Tests\Support\DatabaseTestCase;
use PHPUnit\Framework\Attributes\DataProvider;

/**
 * Matches written by requests that run at the same moment, each in its own process on the real
 * database: whatever the interleaving, they end in exactly one consistent state.
 */
final class MatchRacesTest extends DatabaseTestCase
{
    private const MATCH = '6f1c2d3e-4a5b-4c6d-8e7f-90a1b2c3d4e5';
    private const SUCCEEDED = 0;
    private const NOT_FOUND = 3;

    protected function setUp(): void
    {
        parent::setUp();
        $session = $this->signIn();
        foreach (['Anna', 'Ben'] as $name) {
            $this->send('POST', '/api/persons', ['name' => $name], $session);
        }
        $this->send('POST', '/api/games', ['name' => 'Schach', 'kind' => 'duel'], $session);
    }

    public function testParallelIdenticalRecordsCreateOneMatch(): void
    {
        $outcomes = $this->race(array_fill(0, 8, ['record', 'first']));

        self::assertSame(['created'], array_values(array_filter($outcomes, static fn(string $outcome): bool => $outcome === 'created')));
        self::assertSame(['replayed'], array_values(array_unique(array_filter($outcomes, static fn(string $outcome): bool => $outcome !== 'created'))));
        self::assertSame([['id' => self::MATCH]], $this->rows('SELECT id FROM matches'));
        self::assertCount(1, $this->rows('SELECT id FROM idempotency_keys'));
        self::assertSame([['operation' => 'create']], $this->matchEvents());
    }

    public function testParallelRecordsOfOneIdWithOtherContentRecordOneMatchAndAnswerTheOthers409(): void
    {
        $outcomes = ['first', 'second', 'first', 'second', 'first', 'second', 'first', 'second'];

        $answers = $this->race(array_map(static fn(string $outcome): array => ['record', $outcome], $outcomes));

        $matches = $this->rows('SELECT outcome FROM matches');
        self::assertCount(1, $matches);
        self::assertSame(['created'], array_values(array_filter($answers, static fn(string $answer): bool => $answer === 'created')));
        foreach ($outcomes as $process => $outcome) {
            self::assertContains($answers[$process], $outcome === $matches[0]['outcome'] ? ['created', 'replayed'] : ['conflict']);
        }
        self::assertSame([['operation' => 'create']], $this->matchEvents());
    }

    /**
     * The undo either comes first and finds nothing (the match stays), or after the record and
     * removes it; either way the id stays known, so the record is never repeated.
     */
    public function testARecordRacingItsUndoEndsInOneConsistentState(): void
    {
        [$record, $undo] = $this->race([['record', 'first'], ['undo', 'first']]);

        self::assertSame('created', $record);
        self::assertContains($undo, ['done', 'not-found']);
        self::assertSame($undo === 'done' ? [] : [['id' => self::MATCH]], $this->rows('SELECT id FROM matches'));
        self::assertSame(
            $undo === 'done' ? [['operation' => 'create'], ['operation' => 'delete']] : [['operation' => 'create']],
            $this->matchEvents(),
        );
        self::assertCount(1, $this->rows('SELECT id FROM idempotency_keys'));
    }

    /**
     * The game's deletion records what exists under its lock: a match recorded before it is in
     * that set and goes with the game; a recording that waited for it finds no game (404) and
     * leaves nothing behind, not even its id.
     */
    public function testARecordRacingTheGamesDeletionIsInTheRecordedSetOrRefused(): void
    {
        [$record, $deletion] = $this->race([['record', 'first'], ['delete-game', 'first']]);

        self::assertSame('done', $deletion);
        self::assertContains($record, ['created', 'not-found']);
        self::assertSame([], [...$this->rows('SELECT id FROM matches'), ...$this->rows('SELECT id FROM games')]);
        self::assertSame(
            $record === 'created' ? [['operation' => 'create', 'cause_kind' => null], ['operation' => 'delete', 'cause_kind' => 'game']] : [],
            $this->rows(
                "SELECT e.operation, c.subject_kind AS cause_kind FROM audit_events e LEFT JOIN audit_events c ON c.id = e.cause_id
                  WHERE e.subject_kind = 'match' ORDER BY e.id",
            ),
        );
        self::assertCount($record === 'created' ? 1 : 0, $this->rows('SELECT id FROM idempotency_keys'));
    }

    /**
     * The game lock orders a recording and a restart: the match is in the run it committed in,
     * the old one if it locked the game first, the new one if it waited for the restart.
     */
    public function testARecordRacingARestartLandsInExactlyOneRun(): void
    {
        [$record, $restart] = $this->race([['record', 'first'], ['restart', 'first']]);

        self::assertSame(['created', 'done'], [$record, $restart]);
        self::assertSame([['run' => '2']], $this->rows('SELECT CAST(run AS CHAR) AS run FROM games'));
        // Each recorded its event while it held the game row, so their order is the lock's.
        $order = $this->rows("SELECT subject_kind FROM audit_events WHERE subject_kind = 'match' OR (subject_kind = 'game' AND operation = 'update') ORDER BY id");
        self::assertCount(2, $order);
        $recordedFirst = $order[0]['subject_kind'] === 'match';
        self::assertSame([['run' => $recordedFirst ? '1' : '2']], $this->rows('SELECT CAST(run AS CHAR) AS run FROM matches'));
    }

    /**
     * @return iterable<string, array{'game'|'person', 'game'|'person'}>
     */
    public static function deletionsSharingAMatch(): iterable
    {
        yield 'game, then person' => ['game', 'person'];
        yield 'person, then game' => ['person', 'game'];
    }

    /**
     * A game's and a person's deletion that share a match lock it from opposite ends: the game
     * deletion locks the game, then the match, then reads the person's name; the person
     * deletion locks the person, then clears the match's side. They take turns under the one
     * deletion lock, so both succeed without a deadlock (not even one a retry would hide).
     *
     * @param 'game'|'person' $first
     * @param 'game'|'person' $second
     */
    #[DataProvider('deletionsSharingAMatch')]
    public function testAGameAndAPersonDeletionThatShareAMatchBothSucceedWithoutADeadlock(string $first, string $second): void
    {
        $this->record();
        $deadlocks = $this->deadlocks();

        $exitCodes = $this->interleave([$first, $second]);

        self::assertSame([self::SUCCEEDED, self::SUCCEEDED], $exitCodes);
        self::assertSame($deadlocks, $this->deadlocks(), 'no deadlock');
        self::assertSame([], [...$this->rows('SELECT id FROM matches'), ...$this->rows('SELECT id FROM games')]);
        self::assertSame([['name' => 'Anna']], $this->rows('SELECT name FROM persons'));
        $removed = $this->rows("SELECT before_json FROM audit_events WHERE subject_kind = 'match' AND operation = 'delete'");
        self::assertCount(1, $removed);
        self::assertIsString($removed[0]['before_json']);
        $snapshot = json_decode($removed[0]['before_json'], true);
        self::assertIsArray($snapshot);
        self::assertSame($first === 'game' ? 'Ben' : null, $snapshot['second'], 'the names as the game deletion found them');
    }

    /**
     * An undo racing its game's deletion: the undo locks the match before the game, the
     * deletion the game before the match. When they deadlock, the loser runs again; either
     * way the match's removal is recorded exactly once, by whichever ran first.
     */
    public function testAnUndoRacingItsGamesDeletionEndsAsIfTheyRanInTurn(): void
    {
        $this->record();

        [$undo, $deletion] = $this->interleave(['undo', 'game']);

        self::assertSame(self::SUCCEEDED, $deletion);
        self::assertContains($undo, [self::SUCCEEDED, self::NOT_FOUND]);
        self::assertSame(
            [['cause_kind' => $undo === self::SUCCEEDED ? null : 'game']],
            $this->rows(
                "SELECT c.subject_kind AS cause_kind FROM audit_events e LEFT JOIN audit_events c ON c.id = e.cause_id
                  WHERE e.subject_kind = 'match' AND e.operation = 'delete'",
            ),
        );
        self::assertSame([], $this->rows('SELECT id FROM matches'));
    }

    private function record(): void
    {
        $response = $this->send('PUT', '/api/matches/' . self::MATCH, ['gameId' => 1, 'firstPersonId' => 1, 'secondPersonId' => 2, 'outcome' => 'first'], $this->signIn());
        self::assertSame(201, $response->getStatusCode(), (string) $response->getBody());
    }

    /**
     * Starts one process per write, all at the same instant.
     *
     * @param list<array{string, string}> $writes each one's role and outcome, as match-race.php takes them
     *
     * @return list<string> each process's answer, in the order given
     */
    private function race(array $writes): array
    {
        $startAt = microtime(true) + 1.0;
        $processes = [];
        foreach ($writes as [$role, $outcome]) {
            $process = proc_open(
                [PHP_BINARY, __DIR__ . '/../Support/match-race.php', (string) $startAt, $role, self::MATCH, '1', '1', '2', $outcome, '1'],
                [1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
                $pipes,
            );
            self::assertIsResource($process);
            $processes[] = [$process, $pipes];
        }
        $answers = [];
        foreach ($processes as [$process, $pipes]) {
            $answer = (string) stream_get_contents($pipes[1]);
            $errors = (string) stream_get_contents($pipes[2]);
            fclose($pipes[1]);
            fclose($pipes[2]);
            self::assertSame(0, proc_close($process), $answer . $errors);
            $answers[] = $answer;
        }

        return $answers;
    }

    /**
     * Holds the match under a shared lock, starts the first write and waits until it waits,
     * then the second and waits until it waits too, then lets go of the match. The order is
     * the same on every run; nothing depends on timing.
     *
     * @param array{'game'|'person'|'undo', 'game'|'person'|'undo'} $writes
     *
     * @return array{int, int} the exit codes of both
     */
    private function interleave(array $writes): array
    {
        $holder = $this->otherSession();
        $holder->beginTransaction();
        $holder->prepare('SELECT id FROM matches WHERE id = ? LOCK IN SHARE MODE')->execute([self::MATCH]);
        $first = $this->start($writes[0]);
        $this->waitUntilStatementsWait(1);
        $second = $this->start($writes[1]);
        $this->waitUntilStatementsWait(2);
        $holder->commit();

        return [$this->exitCode(...$first), $this->exitCode(...$second)];
    }

    /**
     * @param 'game'|'person'|'undo' $write
     *
     * @return array{resource, array<int, resource>}
     */
    private function start(string $write): array
    {
        [$role, $id] = match ($write) {
            'game' => ['delete-game', '1'],
            'person' => ['delete-person', '2'],
            'undo' => ['undo-match', self::MATCH],
        };
        $process = proc_open(
            [PHP_BINARY, __DIR__ . '/../Support/concurrent-write.php', $role, $id, '1'],
            [1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
            $pipes,
        );
        self::assertIsResource($process);

        return [$process, $pipes];
    }

    /**
     * Waits until `$count` statements on the test database have been running for a while: here,
     * where every statement is quick, those wait for a lock (a row's or the deletion lock).
     */
    private function waitUntilStatementsWait(int $count): void
    {
        $observer = $this->otherSession();
        $deadline = microtime(true) + 10.0;
        while (microtime(true) < $deadline) {
            $waiting = $observer->query(
                "SELECT COUNT(*) FROM information_schema.PROCESSLIST
                  WHERE DB = DATABASE() AND ID <> CONNECTION_ID() AND COMMAND IN ('Query', 'Execute') AND TIME_MS >= 300",
            );
            self::assertNotFalse($waiting);
            if ((int) $waiting->fetchColumn() >= $count) {
                return;
            }
            usleep(100_000);
        }
        self::fail("{$count} writes never waited at the same time");
    }

    /**
     * @param resource             $process
     * @param array<int, resource> $pipes
     */
    private function exitCode($process, array $pipes): int
    {
        $output = stream_get_contents($pipes[1]) . stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        $exitCode = proc_close($process);
        self::assertContains($exitCode, [self::SUCCEEDED, self::NOT_FOUND], (string) $output);

        return $exitCode;
    }

    /** How many deadlocks the server has resolved since it started. */
    private function deadlocks(): int
    {
        $status = $this->otherSession()->query("SHOW GLOBAL STATUS LIKE 'Innodb_deadlocks'");
        self::assertNotFalse($status);

        return (int) $status->fetchColumn(1);
    }

    /**
     * The match events, oldest first.
     *
     * @return list<array<string, mixed>>
     */
    private function matchEvents(): array
    {
        return $this->rows("SELECT operation FROM audit_events WHERE subject_kind = 'match' ORDER BY id");
    }
}
