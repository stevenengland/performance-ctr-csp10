<?php

declare(strict_types=1);

namespace Performance\Domain\Games;

use DateTimeImmutable;
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
use Performance\Domain\PendingResult;
use Performance\Domain\PersonDependentCounts;
use Performance\Domain\PersonDependents;
use Performance\Domain\QuarterHours;
use Performance\Domain\RequestConflict;
use Performance\Domain\Timestamp;
use Performance\Domain\ValidationFailed;
use Performance\Domain\VerifiableKind;
use Performance\Domain\VerifiableRows;

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
 * A new result waits for verification (PRD #61): only verified results count in the
 * standings. Its recorded rows provide Verification's port for results.
 *
 * @phpstan-type ResultSnapshot array{game: string, person: string, points: int, pending: bool}
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
     * The results that can count, `r` of a person `p` who exists: the ranking and the days read
     * both start here, so they cannot drift apart.
     */
    private const RANKED = 'results r JOIN persons p ON p.id = r.person_id';
    /**
     * Results with their game's and their person's names, as the audit log keeps them, read
     * through the index given (`%s`) and then their references, in exactly that order: a
     * locking read locks every row it scans, so it must scan only the results the transaction
     * holds already.
     */
    private const SNAPSHOT = 'SELECT STRAIGHT_JOIN r.id, g.name AS game, p.name AS person, r.points, r.pending
        FROM results r FORCE INDEX (%s) JOIN games g ON g.id = r.game_id JOIN persons p ON p.id = r.person_id';
    /** Pending results as the pending queue lists them: their game, its run, the person, the points and the recorder, names as they are now. */
    private const PENDING = 'r.id, r.created_at, a.user_name AS account_name, r.game_id, g.name AS game_name, r.run < g.run AS earlier_run,
                r.person_id, p.name AS person_name, r.points
        FROM results r JOIN games g ON g.id = r.game_id JOIN persons p ON p.id = r.person_id
        LEFT JOIN accounts a ON a.id = r.account_id';

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
                $run = $this->rows()->lockGame($result->gameId, GameKind::Points)['run'];
                $this->pdo->prepare(
                    'INSERT INTO results (id, game_id, person_id, points, run, account_id, created_at, pending) VALUES (?, ?, ?, ?, ?, ?, ?, 1)',
                )->execute([
                    $result->id,
                    $result->gameId,
                    $result->personId,
                    $result->points,
                    $run,
                    $actor->accountId,
                    Timestamp::of($result->createdAt),
                ]);
                $this->audit->record($actor, AuditOperation::Create, AuditSubjectKind::Result, $result->id, null, $this->rows()->snapshot($result->id));
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
     * instead of recording it again. The result is locked before its game and person; see
     * RecordedRows::undo for how that meets a game's or a person's deletion.
     *
     * @throws NotFound when there is no such result
     */
    public function delete(Actor $actor, string $id): void
    {
        $this->rows()->undo($actor, $id);
    }

    /**
     * A points game's ranking in one run: every person with a verified result in it, by the
     * sum of their points (the lowest first when `$lowerWins`, else the highest), then name,
     * then id. Only verified results count (PRD #61); each person names their pending results
     * in the run, and a person whose results in it all wait is listed apart, unranked: a total
     * of nothing never leads a ladder, whichever way it runs and whatever the others' totals.
     *
     * @return Standings<PointsRow>
     */
    public function standings(int $gameId, int $run, bool $lowerWins): Standings
    {
        $direction = $lowerWins ? 'ASC' : 'DESC';
        $statement = $this->pdo->prepare(
            "SELECT p.id, p.name, SUM(IF(r.pending = 0, r.points, 0)) AS total, SUM(r.pending = 0) AS results, SUM(r.pending = 1) AS pending_results
             FROM " . self::RANKED . "
             WHERE r.game_id = ? AND r.run = ?
             GROUP BY p.id, p.name
             ORDER BY SUM(r.pending = 0) = 0, SUM(IF(r.pending = 0, r.points, 0)) {$direction}, p.name, p.id",
        );
        $statement->execute([$gameId, $run]);
        /** @var list<array<string, scalar|null>> $rows */
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC);
        $ranked = [];
        $unranked = [];
        foreach ($rows as $row) {
            if ((int) $row['results'] === 0) {
                $unranked[] = new UnrankedPlayer((int) $row['id'], (string) $row['name'], (int) $row['pending_results']);
            } else {
                $ranked[] = new PointsRow((int) $row['id'], (string) $row['name'], (int) $row['total'], (int) $row['results'], (int) $row['pending_results']);
            }
        }

        return new Standings($ranked, $unranked);
    }

    /**
     * The days the points game was played: the start instants, ascending, of the 15-minute UTC
     * buckets with a verified result of any run, by its recording instant.
     *
     * @return list<DateTimeImmutable>
     */
    public function days(int $gameId): array
    {
        return QuarterHours::of($this->pdo, self::RANKED, 'r.created_at', 'r.game_id = ? AND r.pending = 0', [$gameId]);
    }

    /**
     * A page of a points game's Verlauf: its results of one run, newest first, with the person,
     * the recording account's name (null once deleted) and whether the result waits for
     * verification; pending results are listed and marked.
     *
     * @param string|null $before the `next` of the previous page; null for the newest page of the current run
     *
     * @return HistoryPage<ResultItem>
     *
     * @throws NotFound         when the game is a duel game
     * @throws ValidationFailed for a `before` that names no page or a limit outside 1–100
     */
    public function history(Game $game, ?string $before, int $limit): HistoryPage
    {
        return (new GameHistory($this->pdo))->page(
            $game,
            GameKind::Points,
            'SELECT h.id, h.created_at, h.points, h.person_id, p.name AS person_name, a.user_name AS account_name, h.pending
             FROM results h FORCE INDEX (results_game) JOIN persons p ON p.id = h.person_id
             LEFT JOIN accounts a ON a.id = h.account_id',
            $before,
            $limit,
            self::itemOf(...),
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
        $this->rows()->recordDeletions($actor, $cause, 'results_game', 'game_id', $gameId);
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
        $this->rows()->recordDeletions($actor, $cause, 'results_person', 'person_id', $personId);
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

    /** The results as Verification reaches them (PRD #61); the composition root wires it. */
    public function verifiableRows(): VerifiableRows
    {
        return $this->rows();
    }

    /**
     * The mechanics results share with matches, over the results table.
     *
     * @return RecordedRows<ResultSnapshot>
     */
    private function rows(): RecordedRows
    {
        return new RecordedRows(
            $this->pdo,
            $this->revision,
            $this->audit,
            AuditSubjectKind::Result,
            'results',
            self::SNAPSHOT,
            'r',
            self::snapshotOf(...),
            new PendingRead(VerifiableKind::Result, self::PENDING, self::pendingOf(...)),
        );
    }

    /**
     * @param array<string, scalar|null> $row
     */
    private static function pendingOf(array $row): PendingResult
    {
        return new PendingResult(
            (int) $row['game_id'],
            (string) $row['game_name'],
            (int) $row['earlier_run'] === 1,
            new PersonRef((int) $row['person_id'], (string) $row['person_name']),
            (int) $row['points'],
        );
    }

    /**
     * @param array<string, scalar|null> $row
     *
     * @return ResultSnapshot
     */
    private static function snapshotOf(array $row): array
    {
        return ['game' => (string) $row['game'], 'person' => (string) $row['person'], 'points' => (int) $row['points'], 'pending' => (int) $row['pending'] === 1];
    }

    /**
     * @param array<string, scalar|null> $row
     */
    private static function itemOf(array $row): ResultItem
    {
        return new ResultItem(
            (string) $row['id'],
            new PersonRef((int) $row['person_id'], (string) $row['person_name']),
            (int) $row['points'],
            GameHistory::instant($row['created_at']),
            $row['account_name'] === null ? null : (string) $row['account_name'],
            (int) $row['pending'] === 1,
        );
    }
}
