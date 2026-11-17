<?php

declare(strict_types=1);

namespace Performance\Tests\Integration;

use Performance\Tests\Support\DatabaseTestCase;
use Performance\Tests\Support\InterleavedWrites;
use Performance\Tests\Support\ObservedVerification;
use PHPUnit\Framework\Attributes\DataProvider;

/**
 * Results written, verified and rejected by requests that run at the same moment, each in its
 * own process on the real database: whatever the interleaving, they end in exactly one
 * consistent state, with at most one verify or reject event (PRD #61).
 */
final class ResultRacesTest extends DatabaseTestCase
{
    use InterleavedWrites;
    use ObservedVerification;

    private const RESULT = '6f1c2d3e-4a5b-4c6d-8e7f-90a1b2c3d4e5';
    private const SUCCEEDED = 0;
    private const NOT_FOUND = 3;
    private const ALREADY_VERIFIED = 4;
    /** The bootstrap admin (1) records the result; Anna (2) and Ben (3) may verify or reject it. */
    private const ANNA = 2;
    private const BEN = 3;
    /** The result, verified: Rommé's Verlauf shows it counting, and Anna is ranked. */
    private const VERIFIED = ['history' => [['pending' => false, 'accountName' => 'chef']], 'ranked' => ['Anna'], 'unranked' => []];
    /** The result is gone, Rommé is not: its Verlauf is empty, and nobody is ranked or waits. */
    private const GONE = ['history' => [], 'ranked' => [], 'unranked' => []];

    protected function setUp(): void
    {
        parent::setUp();
        $session = $this->signIn();
        foreach (['Anna', 'Ben'] as $name) {
            $this->send('POST', '/api/persons', ['name' => $name], $session);
        }
        $this->send('POST', '/api/games', ['name' => 'Rommé', 'kind' => 'points'], $session);
        $this->createAccount('anna', 'annas-startpasswort');
        $this->createAccount('ben', 'bens-startpasswort');
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
     * @return iterable<string, array{'delete-game'|'delete-person', 'game'|'person'}>
     */
    public static function deletionsOfTheResult(): iterable
    {
        yield 'its game' => ['delete-game', 'game'];
        yield 'its person' => ['delete-person', 'person'];
    }

    /**
     * An undo racing its game's or its person's deletion: the undo locks the result before the
     * game and the person, the deletion its game or person before the result. When they
     * deadlock, the loser runs again; either way the result's removal is recorded exactly once,
     * by whichever ran first.
     *
     * @param 'delete-game'|'delete-person' $deletion
     * @param 'game'|'person'               $causeKind
     */
    #[DataProvider('deletionsOfTheResult')]
    public function testAnUndoRacingItsGamesOrPersonsDeletionEndsAsIfTheyRanInTurn(string $deletion, string $causeKind): void
    {
        $response = $this->send('PUT', '/api/results/' . self::RESULT, ['gameId' => 1, 'personId' => 1, 'points' => -20], $this->signIn());
        self::assertSame(201, $response->getStatusCode(), (string) $response->getBody());

        [$undo, $deleted] = $this->interleave('results', self::RESULT, [['undo-result', self::RESULT], [$deletion, '1']]);

        self::assertSame(self::SUCCEEDED, $deleted);
        self::assertContains($undo, [self::SUCCEEDED, self::NOT_FOUND]);
        self::assertSame(
            [['operation' => 'delete', 'cause_kind' => $undo === self::SUCCEEDED ? null : $causeKind]],
            array_values(array_filter($this->causedResultEvents(), static fn(array $event): bool => $event['operation'] === 'delete')),
        );
        self::assertSame([], $this->rows('SELECT id FROM results'));
    }

    public function testOfConcurrentVerificationsExactlyOneRecordsItsEventAndBumpsTheRevision(): void
    {
        $this->record();
        $revision = $this->revision();

        $exitCodes = $this->interleaveOnTheResult(['verify', 'verify-ben', 'verify']);

        self::assertSame([self::SUCCEEDED, self::SUCCEEDED, self::SUCCEEDED], $exitCodes);
        self::assertSame([['operation' => 'create'], ['operation' => 'verify']], $this->resultEvents());
        self::assertSame($revision + 1, $this->revision());
        self::assertSame(self::VERIFIED, $this->observed());
        self::assertSame([self::ANNA], $this->verifiersOf(self::RESULT));
    }

    public function testOfConcurrentRejectionsExactlyOneRemovesTheResultAndRecordsItsEvent(): void
    {
        $this->record();

        $exitCodes = $this->interleaveOnTheResult(['reject', 'reject-ben', 'reject']);

        sort($exitCodes);
        self::assertSame([self::SUCCEEDED, self::NOT_FOUND, self::NOT_FOUND], $exitCodes);
        self::assertSame([['operation' => 'create'], ['operation' => 'reject']], $this->resultEvents());
        self::assertSame(self::GONE, $this->observed());
    }

    /**
     * Whichever locks the result first decides: a verified result can no longer be rejected
     * (409), and a rejected one is no longer there to verify (404).
     */
    public function testAVerificationRacingARejectionEndsInOneConsistentState(): void
    {
        $this->record();

        [$verify, $reject] = $this->interleaveOnTheResult(['verify', 'reject-ben']);

        self::assertContains([$verify, $reject], [[self::SUCCEEDED, self::ALREADY_VERIFIED], [self::NOT_FOUND, self::SUCCEEDED]]);
        self::assertSame($verify === self::SUCCEEDED ? self::VERIFIED : self::GONE, $this->observed());
        self::assertSame($verify === self::SUCCEEDED ? [self::ANNA] : [], $this->verifiersOf(self::RESULT));
        self::assertSame(
            [['operation' => 'create'], ['operation' => $verify === self::SUCCEEDED ? 'verify' : 'reject']],
            $this->resultEvents(),
        );
    }

    /**
     * @return iterable<string, array{'undo'|'game'|'person', 'game'|'person'|null}>
     */
    public static function removalsOfTheResult(): iterable
    {
        yield 'its undo' => ['undo', null];
        yield "its game's deletion" => ['game', 'game'];
        yield "its person's deletion" => ['person', 'person'];
    }

    /**
     * The undo, the game's and the person's deletion remove the result whether it was verified
     * or not. The deletions lock the game or the person before the result, the verification the
     * other way round; the loser of a deadlock runs again. Either the verified result is removed,
     * or the verification finds it gone; the removal is recorded once, as a delete.
     *
     * @param 'undo'|'game'|'person' $removal
     * @param 'game'|'person'|null    $causeKind what the delete event names as its cause
     */
    #[DataProvider('removalsOfTheResult')]
    public function testAVerificationRacingTheResultsRemovalEndsInOneConsistentState(string $removal, ?string $causeKind): void
    {
        $this->record();

        [$verify, $removed] = $this->interleaveOnTheResult(['verify', $removal]);

        self::assertSame(self::SUCCEEDED, $removed);
        self::assertContains($verify, [self::SUCCEEDED, self::NOT_FOUND]);
        self::assertSame(
            [
                ['operation' => 'create', 'cause_kind' => null],
                ...($verify === self::SUCCEEDED ? [['operation' => 'verify', 'cause_kind' => null]] : []),
                ['operation' => 'delete', 'cause_kind' => $causeKind],
            ],
            $this->causedResultEvents(),
        );
        self::assertSame($removal === 'game' ? null : self::GONE, $this->observed());
    }

    /**
     * Rommé's results as its Verlauf shows them, and who its standings rank and who they list
     * without a rank, as the bootstrap admin sees them; null once Rommé is deleted.
     *
     * @return array{history: list<array{pending: mixed, accountName: mixed}>, ranked: list<mixed>, unranked: list<mixed>}|null
     */
    private function observed(): ?array
    {
        $session = $this->signIn();
        $verlauf = $this->send('GET', '/api/games/1/results', session: $session);
        if ($verlauf->getStatusCode() === 404) {
            return null;
        }
        $items = $this->body($verlauf)['items'];
        self::assertIsList($items);
        $standings = $this->body($this->send('GET', '/api/games/1/standings', session: $session));
        self::assertIsList($standings['rows']);
        self::assertIsList($standings['unranked']);

        return [
            'history' => array_map(static function (mixed $item): array {
                self::assertIsArray($item);

                return ['pending' => $item['pending'], 'accountName' => $item['accountName']];
            }, $items),
            'ranked' => array_column($standings['rows'], 'name'),
            'unranked' => array_column($standings['unranked'], 'name'),
        ];
    }

    private function revision(): int
    {
        $revision = $this->rows('SELECT revision FROM data_revision')[0]['revision'];
        self::assertIsInt($revision);

        return $revision;
    }

    /** Anna's result in Rommé, recorded by the bootstrap admin unless another session is given; it waits for verification. */
    private function record(?string $session = null): void
    {
        $response = $this->send('PUT', '/api/results/' . self::RESULT, ['gameId' => 1, 'personId' => 1, 'points' => -20], $session ?? $this->signIn());
        self::assertSame(201, $response->getStatusCode(), (string) $response->getBody());
    }

    /**
     * Runs the writes on the recorded result in the order given (InterleavedWrites).
     *
     * @param list<'game'|'person'|'undo'|'verify'|'verify-ben'|'reject'|'reject-ben'|'anna-account'> $writes `verify` and `reject` act as Anna;
     *                                                                                                 `anna-account` deletes her account
     *
     * @return list<int> the exit codes, in the order given
     */
    private function interleaveOnTheResult(array $writes): array
    {
        return $this->interleave('results', self::RESULT, array_map(static fn(string $write): array => match ($write) {
            'game' => ['delete-game', '1'],
            'person' => ['delete-person', '1'],
            'undo' => ['undo-result', self::RESULT],
            'verify' => ['verify-result', self::RESULT, self::ANNA],
            'verify-ben' => ['verify-result', self::RESULT, self::BEN],
            'reject' => ['reject-result', self::RESULT, self::ANNA],
            'reject-ben' => ['reject-result', self::RESULT, self::BEN],
            'anna-account' => ['delete-account', (string) self::ANNA],
        }, $writes));
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
