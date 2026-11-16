<?php

declare(strict_types=1);

namespace Performance\Domain\Games;

use LogicException;
use PDO;
use PDOException;
use Performance\Domain\Actor;
use Performance\Domain\AuditLog;
use Performance\Domain\AuditOperation;
use Performance\Domain\AuditSubjectKind;
use Performance\Domain\Clock;
use Performance\Domain\DatabaseError;
use Performance\Domain\DataRevision;
use Performance\Domain\GameDependents;
use Performance\Domain\Idempotency;
use Performance\Domain\NotFound;
use Performance\Domain\PersonDependentCounts;
use Performance\Domain\PersonDependents;
use Performance\Domain\RequestConflict;
use Performance\Domain\Timestamp;
use Performance\Domain\ValidationFailed;

/**
 * The results of points games, end to end: record one idempotently on the client's UUID, undo
 * it, and rank a game's run by the sum of each person's points. As a GameDependents member, a
 * game's results go with it; as a PersonDependents member, a deleted person's results go with
 * them. Every write names its actor and is recorded in the audit log in its own transaction,
 * together with the data revision bump; a replay, a conflict or a failure records nothing.
 *
 * Recording locks the game row `FOR SHARE` first, so it checks the kind and copies the run
 * while no restart, edit or deletion of the game can change them: a recording racing a
 * restart lands in exactly one run, the one it committed in.
 *
 * Every read in a write locks what it reads (ADR 0004); referenced rows only under a shared
 * lock, which an insert also takes for its foreign key checks.
 *
 * @phpstan-type ResultSnapshot array{game: string, person: string, points: int}
 */
final readonly class Results implements GameDependents, PersonDependents
{
    /** The fingerprint tag of a result request: a UUID is unique across entries, matches and results. */
    private const KIND = 'result';
    private const MIN_POINTS = -9999;
    private const MAX_POINTS = 9999;
    private const PERSON_ERROR = 'Person nicht gefunden.';
    private const POINTS_ERROR = 'Ganze Zahl von −9.999 bis 9.999.';
    /**
     * Results with their game's and their person's names, as the audit log keeps them, read
     * through the index given (`%s`) and then their references, in exactly that order: a
     * locking read locks every row it scans, so it must scan only the results the transaction
     * holds already.
     */
    private const SNAPSHOT = 'SELECT STRAIGHT_JOIN r.id, g.name AS game, p.name AS person, r.points
        FROM results r FORCE INDEX (%s) JOIN games g ON g.id = r.game_id JOIN persons p ON p.id = r.person_id';

    public function __construct(
        private PDO $pdo,
        private Clock $clock,
        private DataRevision $revision,
        private AuditLog $audit,
        private Idempotency $idempotency,
    ) {}

    /**
     * Records a result in its game's current run, or answers the original for a UUID recorded
     * before with the same content, even after that result was undone or its game deleted.
     *
     * @param int|null $gameId   null for a missing or non-integer field
     * @param int|null $personId null for a missing or non-integer field
     * @param int|null $points   null for a missing or non-integer field
     *
     * @throws NotFound when there is no such game
     * @throws ValidationFailed for points outside −9 999 to 9 999, a missing or unknown person,
     *                          or a game of another kind
     * @throws RequestConflict when the UUID was used before for other content
     */
    public function record(Actor $actor, string $id, ?int $gameId, ?int $personId, ?int $points): RecordedResult
    {
        $result = new Result($id, $gameId ?? 0, $personId ?? 0, self::validPoints($personId, $points), $this->clock->now());
        $fingerprint = Idempotency::fingerprint(self::KIND, [$result->gameId, $result->personId, $result->points]);
        try {
            $recordedAt = $this->idempotency->write($id, $fingerprint, $result->createdAt, function () use ($result, $actor): void {
                $run = $this->lockGameForRecording($result->gameId);
                $this->pdo->prepare(
                    'INSERT INTO results (id, game_id, person_id, points, run, account_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
                )->execute([
                    $result->id,
                    $result->gameId,
                    $result->personId,
                    $result->points,
                    $run,
                    $actor->accountId,
                    Timestamp::of($result->createdAt),
                ]);
                $this->audit->record($actor, AuditOperation::Create, AuditSubjectKind::Result, $result->id, null, $this->snapshot($result->id));
            });
        } catch (PDOException $failure) {
            // The game is locked, so a missing parent is the person.
            throw DatabaseError::is($failure, DatabaseError::MISSING_PARENT) ? new ValidationFailed(['personId' => self::PERSON_ERROR]) : $failure;
        }

        return new RecordedResult(
            $recordedAt === null ? $result : new Result($id, $result->gameId, $result->personId, $result->points, $recordedAt),
            $recordedAt === null,
        );
    }

    /**
     * Deletes a result (undo). Its UUID stays known, so a late retry of its recording replays
     * instead of recording it again.
     *
     * The result is locked before its game and person, which a game's or a person's deletion
     * lock before their results; when the two deadlock, DataRevision runs the loser again,
     * which then finds the other's result.
     *
     * @throws NotFound when there is no such result
     */
    public function delete(Actor $actor, string $id): void
    {
        $this->revision->write(function () use ($actor, $id): void {
            $locked = $this->pdo->prepare('SELECT id FROM results WHERE id = ? FOR UPDATE');
            $locked->execute([$id]);
            if ($locked->fetchColumn() === false) {
                throw new NotFound($id);
            }
            $this->audit->record($actor, AuditOperation::Delete, AuditSubjectKind::Result, $id, $this->snapshot($id), null);
            $this->pdo->prepare('DELETE FROM results WHERE id = ?')->execute([$id]);
        });
    }

    /**
     * A points game's ranking in one run: every person with a result in it, by the sum of
     * their points (the lowest first when `$lowerWins`, else the highest), then name, then id.
     *
     * @return list<PointsRow>
     */
    public function standings(int $gameId, int $run, bool $lowerWins): array
    {
        $direction = $lowerWins ? 'ASC' : 'DESC';
        $statement = $this->pdo->prepare(
            "SELECT p.id, p.name, SUM(r.points) AS total, COUNT(*) AS results
             FROM results r JOIN persons p ON p.id = r.person_id
             WHERE r.game_id = ? AND r.run = ?
             GROUP BY p.id, p.name
             ORDER BY total {$direction}, p.name, p.id",
        );
        $statement->execute([$gameId, $run]);
        /** @var list<array<string, scalar|null>> $rows */
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC);

        return array_map(
            static fn(array $row): PointsRow => new PointsRow((int) $row['id'], (string) $row['name'], (int) $row['total'], (int) $row['results']),
            $rows,
        );
    }

    /** How many results of every run belong to the game; read without locks, for the delete dialog. */
    public function count(int $gameId): int
    {
        $statement = $this->pdo->prepare('SELECT COUNT(*) FROM results WHERE game_id = ?');
        $statement->execute([$gameId]);

        return (int) $statement->fetchColumn();
    }

    /**
     * Locks the game's results of every run for update, then records each one's deletion,
     * caused by the game's, with its names as they are now. The game row is locked already,
     * so no result can be recorded for the game until its deletion ends.
     */
    public function recordRemoval(Actor $actor, int $gameId, int $cause): void
    {
        $this->recordDeletionOf($actor, $cause, 'results_game', 'game_id', $gameId);
    }

    /** How many results the person has, in every game and run; read without locks, for the delete dialog. */
    public function countOfPerson(int $personId): PersonDependentCounts
    {
        $statement = $this->pdo->prepare('SELECT COUNT(*) FROM results WHERE person_id = ?');
        $statement->execute([$personId]);

        return new PersonDependentCounts(results: (int) $statement->fetchColumn());
    }

    /**
     * Locks the person's results of every game and run for update, then records each one's
     * deletion, caused by the person's. The person row is locked already, so no result can be
     * recorded for the person until the deletion ends.
     */
    public function recordPersonDeletion(Actor $actor, int $personId, int $cause): void
    {
        $this->recordDeletionOf($actor, $cause, 'results_person', 'person_id', $personId);
    }

    /**
     * Locks the results whose `$column` is `$id` through `$index`, then records one delete per
     * result in result id order, caused by `$cause`. The index is forced so the locks cover
     * exactly those results, whatever the optimizer would pick on a small table.
     *
     * @param 'results_game'|'results_person' $index
     * @param 'game_id'|'person_id'           $column
     */
    private function recordDeletionOf(Actor $actor, int $cause, string $index, string $column, int $id): void
    {
        $locked = $this->pdo->prepare("SELECT id FROM results FORCE INDEX ({$index}) WHERE {$column} = ? FOR UPDATE");
        $locked->execute([$id]);
        if ($locked->fetchAll(PDO::FETCH_COLUMN) === []) {
            return;
        }
        $statement = $this->pdo->prepare(sprintf(self::SNAPSHOT, $index) . " WHERE r.{$column} = ? ORDER BY r.id LOCK IN SHARE MODE");
        $statement->execute([$id]);
        /** @var list<array<string, scalar|null>> $rows */
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC);
        $this->audit->recordCaused(
            $actor,
            $cause,
            AuditOperation::Delete,
            AuditSubjectKind::Result,
            array_map(static fn(array $row): array => [(string) $row['id'], self::snapshotOf($row), null], $rows),
        );
    }

    /**
     * The checks that need no database: a person, and whole points in range.
     *
     * @throws ValidationFailed
     */
    private static function validPoints(?int $personId, ?int $points): int
    {
        $errors = array_filter([
            'personId' => $personId === null ? self::PERSON_ERROR : null,
            'points' => $points === null || $points < self::MIN_POINTS || $points > self::MAX_POINTS ? self::POINTS_ERROR : null,
        ]);
        if ($errors !== []) {
            throw new ValidationFailed($errors);
        }

        return $points ?? throw new LogicException('Points were checked above');
    }

    /**
     * Locks the game row for share for the rest of the recording and checks that it is a
     * points game.
     *
     * @return int the game's current run
     *
     * @throws NotFound when there is no such game
     * @throws ValidationFailed for a game of another kind
     */
    private function lockGameForRecording(int $gameId): int
    {
        $statement = $this->pdo->prepare('SELECT kind, run FROM games WHERE id = ? LOCK IN SHARE MODE');
        $statement->execute([$gameId]);
        /** @var array{kind: string, run: int|string}|false $game */
        $game = $statement->fetch(PDO::FETCH_ASSOC);
        if ($game === false) {
            throw new NotFound((string) $gameId);
        }
        if ($game['kind'] !== GameKind::Points->value) {
            throw new ValidationFailed(['gameId' => 'Kein Punktespiel.']);
        }

        return (int) $game['run'];
    }

    /**
     * One result the transaction holds already, as the audit log keeps it.
     *
     * @return ResultSnapshot
     */
    private function snapshot(string $id): array
    {
        $statement = $this->pdo->prepare(sprintf(self::SNAPSHOT, 'PRIMARY') . ' WHERE r.id = ? LOCK IN SHARE MODE');
        $statement->execute([$id]);
        /** @var array<string, scalar|null>|false $row */
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        if ($row === false) {
            throw new LogicException("Result {$id} is not there to be recorded");
        }

        return self::snapshotOf($row);
    }

    /**
     * @param array<string, scalar|null> $row
     *
     * @return ResultSnapshot
     */
    private static function snapshotOf(array $row): array
    {
        return ['game' => (string) $row['game'], 'person' => (string) $row['person'], 'points' => (int) $row['points']];
    }
}
