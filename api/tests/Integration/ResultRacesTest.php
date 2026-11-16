<?php

declare(strict_types=1);

namespace Performance\Tests\Integration;

use Performance\Tests\Support\DatabaseTestCase;

/**
 * Results written by requests that run at the same moment, each in its own process on the real
 * database: whatever the interleaving, they end in exactly one consistent state.
 */
final class ResultRacesTest extends DatabaseTestCase
{
    private const RESULT = '6f1c2d3e-4a5b-4c6d-8e7f-90a1b2c3d4e5';

    protected function setUp(): void
    {
        parent::setUp();
        $session = $this->signIn();
        foreach (['Anna', 'Ben'] as $name) {
            $this->send('POST', '/api/persons', ['name' => $name], $session);
        }
        $this->send('POST', '/api/games', ['name' => 'Rommé', 'kind' => 'points'], $session);
    }

    public function testParallelIdenticalRecordsCreateOneResult(): void
    {
        $outcomes = $this->race(array_fill(0, 8, ['record', -20]));

        self::assertSame(['created'], array_values(array_filter($outcomes, static fn(string $outcome): bool => $outcome === 'created')));
        self::assertSame(['replayed'], array_values(array_unique(array_filter($outcomes, static fn(string $outcome): bool => $outcome !== 'created'))));
        self::assertSame([['id' => self::RESULT]], $this->rows('SELECT id FROM results'));
        self::assertCount(1, $this->rows('SELECT id FROM idempotency_keys'));
        self::assertSame([['operation' => 'create']], $this->resultEvents());
    }

    public function testParallelRecordsOfOneIdWithOtherContentRecordOneResultAndAnswerTheOthers409(): void
    {
        $points = [-20, 35, -20, 35, -20, 35, -20, 35];

        $answers = $this->race(array_map(static fn(int $points): array => ['record', $points], $points));

        $results = $this->rows('SELECT CAST(points AS CHAR) AS points FROM results');
        self::assertCount(1, $results);
        self::assertSame(['created'], array_values(array_filter($answers, static fn(string $answer): bool => $answer === 'created')));
        foreach ($points as $process => $sent) {
            self::assertContains($answers[$process], (string) $sent === $results[0]['points'] ? ['created', 'replayed'] : ['conflict']);
        }
        self::assertSame([['operation' => 'create']], $this->resultEvents());
    }

    /**
     * The undo either comes first and finds nothing (the result stays), or after the record
     * and removes it; either way the id stays known, so the record is never repeated.
     */
    public function testARecordRacingItsUndoEndsInOneConsistentState(): void
    {
        [$record, $undo] = $this->race([['record', -20], ['undo', -20]]);

        self::assertSame('created', $record);
        self::assertContains($undo, ['done', 'not-found']);
        self::assertSame($undo === 'done' ? [] : [['id' => self::RESULT]], $this->rows('SELECT id FROM results'));
        self::assertSame(
            $undo === 'done' ? [['operation' => 'create'], ['operation' => 'delete']] : [['operation' => 'create']],
            $this->resultEvents(),
        );
        self::assertCount(1, $this->rows('SELECT id FROM idempotency_keys'));
    }

    /**
     * The game lock orders a recording and a restart: the result is in the run it committed
     * in, the old one if it locked the game first, the new one if it waited for the restart.
     */
    public function testARecordRacingARestartLandsInExactlyOneRun(): void
    {
        [$record, $restart] = $this->race([['record', -20], ['restart', -20]]);

        self::assertSame(['created', 'done'], [$record, $restart]);
        self::assertSame([['run' => '2']], $this->rows('SELECT CAST(run AS CHAR) AS run FROM games'));
        // Each recorded its event while it held the game row, so their order is the lock's.
        $order = $this->rows("SELECT subject_kind FROM audit_events WHERE subject_kind = 'result' OR (subject_kind = 'game' AND operation = 'update') ORDER BY id");
        self::assertCount(2, $order);
        $recordedFirst = $order[0]['subject_kind'] === 'result';
        self::assertSame([['run' => $recordedFirst ? '1' : '2']], $this->rows('SELECT CAST(run AS CHAR) AS run FROM results'));
    }

    /**
     * The game's deletion records what exists under its lock: a result recorded before it is
     * in that set and goes with the game; a recording that waited for it finds no game (404)
     * and leaves nothing behind, not even its id.
     */
    public function testARecordRacingTheGamesDeletionIsInTheRecordedSetOrRefused(): void
    {
        [$record, $deletion] = $this->race([['record', -20], ['delete-game', -20]]);

        self::assertSame('done', $deletion);
        self::assertContains($record, ['created', 'not-found']);
        self::assertSame([], [...$this->rows('SELECT id FROM results'), ...$this->rows('SELECT id FROM games')]);
        self::assertSame(
            $record === 'created' ? [['operation' => 'create', 'cause_kind' => null], ['operation' => 'delete', 'cause_kind' => 'game']] : [],
            $this->causedResultEvents(),
        );
        self::assertCount($record === 'created' ? 1 : 0, $this->rows('SELECT id FROM idempotency_keys'));
    }

    /**
     * The person's deletion records what exists under its lock: a result recorded before it is
     * in that set and goes with the person; a recording that waited for it finds no person
     * (422) and leaves nothing behind, not even its id.
     */
    public function testARecordRacingThePersonsDeletionIsInTheRecordedSetOrRefused(): void
    {
        [$record, $deletion] = $this->race([['record', -20], ['delete-person', -20]]);

        self::assertSame('done', $deletion);
        self::assertContains($record, ['created', 'invalid']);
        self::assertSame([], $this->rows('SELECT id FROM results'));
        self::assertSame([['name' => 'Ben']], $this->rows('SELECT name FROM persons'));
        self::assertSame(
            $record === 'created' ? [['operation' => 'create', 'cause_kind' => null], ['operation' => 'delete', 'cause_kind' => 'person']] : [],
            $this->causedResultEvents(),
        );
        self::assertCount($record === 'created' ? 1 : 0, $this->rows('SELECT id FROM idempotency_keys'));
    }

    /**
     * Starts one process per write, all at the same instant, each for Anna in Rommé.
     *
     * @param list<array{string, int}> $writes each one's role and points, as result-race.php takes them
     *
     * @return list<string> each process's answer, in the order given
     */
    private function race(array $writes): array
    {
        $startAt = microtime(true) + 1.0;
        $processes = [];
        foreach ($writes as [$role, $points]) {
            $process = proc_open(
                [PHP_BINARY, __DIR__ . '/../Support/result-race.php', (string) $startAt, $role, self::RESULT, '1', '1', (string) $points, '1'],
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
     * The result events, oldest first.
     *
     * @return list<array<string, mixed>>
     */
    private function resultEvents(): array
    {
        return $this->rows("SELECT operation FROM audit_events WHERE subject_kind = 'result' ORDER BY id");
    }

    /**
     * The result events with the kind of their cause, oldest first.
     *
     * @return list<array<string, mixed>>
     */
    private function causedResultEvents(): array
    {
        return $this->rows(
            "SELECT e.operation, c.subject_kind AS cause_kind FROM audit_events e LEFT JOIN audit_events c ON c.id = e.cause_id
              WHERE e.subject_kind = 'result' ORDER BY e.id",
        );
    }
}
