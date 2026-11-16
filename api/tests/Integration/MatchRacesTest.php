<?php

declare(strict_types=1);

namespace Performance\Tests\Integration;

use Performance\Tests\Support\DatabaseTestCase;
use Performance\Tests\Support\InterleavedWrites;
use PHPUnit\Framework\Attributes\DataProvider;

/**
 * Matches written, verified and rejected by requests that run at the same moment, each in its
 * own process on the real database: whatever the interleaving, they end in exactly one
 * consistent state, with at most one verify or reject event (PRD #61).
 */
final class MatchRacesTest extends DatabaseTestCase
{
    use InterleavedWrites;

    private const MATCH = '6f1c2d3e-4a5b-4c6d-8e7f-90a1b2c3d4e5';
    private const SUCCEEDED = 0;
    private const NOT_FOUND = 3;
    private const ALREADY_VERIFIED = 4;
    /** The bootstrap admin (1) records the match; Anna (2) and Ben (3) may verify or reject it. */
    private const ANNA = 2;
    private const BEN = 3;

    protected function setUp(): void
    {
        parent::setUp();
        $session = $this->signIn();
        foreach (['Anna', 'Ben'] as $name) {
            $this->send('POST', '/api/persons', ['name' => $name], $session);
        }
        $this->send('POST', '/api/games', ['name' => 'Schach', 'kind' => 'duel'], $session);
        $this->createAccount('anna', 'annas-startpasswort');
        $this->createAccount('ben', 'bens-startpasswort');
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
     * The person's deletion records what exists under its lock: a match recorded before it is
     * in that set and keeps its row with the person's side cleared; a recording that waited for
     * it finds no person (422) and leaves nothing behind. Every affected match records one
     * update event, caused by the deletion.
     */
    public function testARecordRacingThePersonsDeletionIsInTheRecordedSetOrRefused(): void
    {
        $session = $this->signIn();
        foreach (['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'] as $earlier) {
            $this->send('PUT', "/api/matches/{$earlier}", ['gameId' => 1, 'firstPersonId' => 1, 'secondPersonId' => 2, 'outcome' => 'draw'], $session);
        }

        [$record, $deletion] = $this->race([['record', 'first'], ['delete-person', 'first']]);

        self::assertSame('done', $deletion);
        self::assertContains($record, ['created', 'invalid']);
        $kept = array_column($this->rows('SELECT id FROM matches WHERE first_person_id IS NULL AND second_person_id = 2 ORDER BY id'), 'id');
        self::assertCount($record === 'created' ? 3 : 2, $kept);
        self::assertSame($kept, array_column($this->rows('SELECT id FROM matches ORDER BY id'), 'id'));
        self::assertSame(
            $kept,
            array_column(
                $this->rows(
                    "SELECT e.subject_id FROM audit_events e JOIN audit_events c ON c.id = e.cause_id
                      WHERE e.subject_kind = 'match' AND e.operation = 'update' AND c.subject_kind = 'person' ORDER BY e.id",
                ),
                'subject_id',
            ),
        );
        self::assertCount(count($kept), $this->rows('SELECT id FROM idempotency_keys'));
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

        $exitCodes = $this->interleaveOnTheMatch([$first, $second]);

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

        [$undo, $deletion] = $this->interleaveOnTheMatch(['undo', 'game']);

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

    /**
     * @return iterable<string, array{list<'person'|'undo'>}>
     */
    public static function undoAndPersonDeletion(): iterable
    {
        yield 'undo, then person' => [['undo', 'person']];
        yield 'person, then undo' => [['person', 'undo']];
    }

    /**
     * An undo racing the deletion of one of the match's persons: the undo locks the match before
     * the person, the deletion the person before the match. When they deadlock, the loser runs
     * again; either way both succeed and end as if they ran in turn. The match is gone, removed
     * once by the undo, and its side is cleared by an update caused by the deletion only if the
     * deletion ran first; the undo's event then names the side as cleared.
     *
     * @param list<'person'|'undo'> $writes
     */
    #[DataProvider('undoAndPersonDeletion')]
    public function testAnUndoRacingAPersonsDeletionEndsAsIfTheyRanInTurn(array $writes): void
    {
        $this->record();

        $exitCodes = $this->interleaveOnTheMatch($writes);

        self::assertSame([self::SUCCEEDED, self::SUCCEEDED], $exitCodes);
        self::assertSame([], $this->rows('SELECT id FROM matches'));
        self::assertSame([['name' => 'Anna']], $this->rows('SELECT name FROM persons'));
        $events = $this->rows(
            "SELECT e.operation, c.subject_kind AS cause_kind, e.before_json FROM audit_events e LEFT JOIN audit_events c ON c.id = e.cause_id
              WHERE e.subject_kind = 'match' AND e.operation <> 'create' ORDER BY e.id",
        );
        $kinds = array_map(static fn(array $event): array => [$event['operation'], $event['cause_kind']], $events);
        self::assertContains($kinds, [[['delete', null]], [['update', 'person'], ['delete', null]]]);
        $undone = end($events);
        self::assertIsArray($undone);
        self::assertIsString($undone['before_json']);
        $snapshot = json_decode($undone['before_json'], true);
        self::assertIsArray($snapshot);
        self::assertSame(count($events) === 1 ? 'Ben' : null, $snapshot['second'], 'the undo records the match as it found it');
    }

    public function testOfConcurrentVerificationsExactlyOneRecordsItsEventAndBumpsTheRevision(): void
    {
        $this->record();
        $revision = $this->revision();

        $exitCodes = $this->interleaveOnTheMatch(['verify', 'verify-ben', 'verify']);

        self::assertSame([self::SUCCEEDED, self::SUCCEEDED, self::SUCCEEDED], $exitCodes);
        self::assertSame([['operation' => 'create'], ['operation' => 'verify']], $this->matchEvents());
        self::assertSame($revision + 1, $this->revision());
        self::assertSame([['pending' => 0, 'verified_by_account_id' => self::ANNA]], $this->verificationState());
    }

    public function testOfConcurrentRejectionsExactlyOneRemovesTheMatchAndRecordsItsEvent(): void
    {
        $this->record();

        $exitCodes = $this->interleaveOnTheMatch(['reject', 'reject-ben', 'reject']);

        sort($exitCodes);
        self::assertSame([self::SUCCEEDED, self::NOT_FOUND, self::NOT_FOUND], $exitCodes);
        self::assertSame([['operation' => 'create'], ['operation' => 'reject']], $this->matchEvents());
        self::assertSame([], $this->verificationState());
    }

    /**
     * Whichever locks the match first decides: a verified match can no longer be rejected
     * (409), and a rejected one is no longer there to verify (404).
     */
    public function testAVerificationRacingARejectionEndsInOneConsistentState(): void
    {
        $this->record();

        [$verify, $reject] = $this->interleaveOnTheMatch(['verify', 'reject-ben']);

        self::assertContains([$verify, $reject], [[self::SUCCEEDED, self::ALREADY_VERIFIED], [self::NOT_FOUND, self::SUCCEEDED]]);
        self::assertSame($verify === self::SUCCEEDED ? [['pending' => 0, 'verified_by_account_id' => self::ANNA]] : [], $this->verificationState());
        self::assertSame(
            [['operation' => 'create'], ['operation' => $verify === self::SUCCEEDED ? 'verify' : 'reject']],
            $this->matchEvents(),
        );
    }

    /** The undo removes the match whether it was verified or not; a verification after it finds nothing. */
    public function testAVerificationRacingTheUndoEndsInOneConsistentState(): void
    {
        $this->record();

        [$verify, $undo] = $this->interleaveOnTheMatch(['verify', 'undo']);

        self::assertSame(self::SUCCEEDED, $undo);
        self::assertContains($verify, [self::SUCCEEDED, self::NOT_FOUND]);
        self::assertSame(
            $verify === self::SUCCEEDED ? ['create', 'verify', 'delete'] : ['create', 'delete'],
            array_column($this->matchEvents(), 'operation'),
        );
        self::assertSame([], $this->verificationState());
    }

    /**
     * The person's deletion and the verification lock the match and the person in opposite
     * orders; the loser of the deadlock runs again. Either way the match ends verified with the
     * person's side cleared, verified exactly once.
     */
    public function testAVerificationRacingAPersonsDeletionEndsVerifiedWithTheSideCleared(): void
    {
        $this->record();

        $exitCodes = $this->interleaveOnTheMatch(['verify', 'person']);

        self::assertSame([self::SUCCEEDED, self::SUCCEEDED], $exitCodes);
        self::assertSame([['pending' => 0, 'verified_by_account_id' => self::ANNA]], $this->verificationState());
        self::assertSame([['first_person_id' => 1, 'second_person_id' => null]], $this->rows('SELECT first_person_id, second_person_id FROM matches'));
        $operations = array_column($this->matchEvents(), 'operation');
        self::assertContains($operations, [['create', 'verify', 'update'], ['create', 'update', 'verify']]);
    }

    /**
     * The game's deletion and the verification lock the match and the game in opposite orders;
     * the loser of the deadlock runs again. Either the verified match goes with the game, or
     * the verification finds it gone.
     */
    public function testAVerificationRacingTheGamesDeletionEndsInOneConsistentState(): void
    {
        $this->record();

        [$verify, $deletion] = $this->interleaveOnTheMatch(['verify', 'game']);

        self::assertSame(self::SUCCEEDED, $deletion);
        self::assertContains($verify, [self::SUCCEEDED, self::NOT_FOUND]);
        self::assertSame(
            $verify === self::SUCCEEDED ? ['create', 'verify', 'delete'] : ['create', 'delete'],
            array_column($this->matchEvents(), 'operation'),
        );
        self::assertSame([], $this->verificationState());
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function verificationState(): array
    {
        return $this->rows('SELECT pending, verified_by_account_id FROM matches');
    }

    private function revision(): int
    {
        $revision = $this->rows('SELECT revision FROM data_revision')[0]['revision'];
        self::assertIsInt($revision);

        return $revision;
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
     * Runs the writes on the recorded match in the order given (InterleavedWrites).
     *
     * @param list<'game'|'person'|'undo'|'verify'|'verify-ben'|'reject'|'reject-ben'> $writes `verify` and `reject` act as Anna
     *
     * @return list<int> the exit codes, in the order given
     */
    private function interleaveOnTheMatch(array $writes): array
    {
        return $this->interleave('matches', self::MATCH, array_map(static fn(string $write): array => match ($write) {
            'game' => ['delete-game', '1'],
            'person' => ['delete-person', '2'],
            'undo' => ['undo-match', self::MATCH],
            'verify' => ['verify-match', self::MATCH, self::ANNA],
            'verify-ben' => ['verify-match', self::MATCH, self::BEN],
            'reject' => ['reject-match', self::MATCH, self::ANNA],
            'reject-ben' => ['reject-match', self::MATCH, self::BEN],
        }, $writes));
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
