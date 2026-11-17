<?php

declare(strict_types=1);

namespace Performance\Domain\Games;

use DateTimeImmutable;
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
use Performance\Domain\Interval;
use Performance\Domain\NotFound;
use Performance\Domain\PendingMatch;
use Performance\Domain\PersonDependentCounts;
use Performance\Domain\PersonDependents;
use Performance\Domain\QuarterHours;
use Performance\Domain\RequestConflict;
use Performance\Domain\Timestamp;
use Performance\Domain\ValidationFailed;
use Performance\Domain\VerifiableKind;
use Performance\Domain\VerifiableRows;

/**
 * The matches of duel games, end to end: record one idempotently on the client's UUID, undo
 * it, and rank a game's run. As a GameDependents member, a game's matches go with it; as a
 * PersonDependents member, a deleted person's matches stay with that side cleared. Every write
 * names its actor and is recorded in the audit log in its own transaction, together with the
 * data revision bump; a replay, a conflict or a failure records nothing.
 *
 * Recording locks the game row `FOR SHARE` first, so it checks the kind and `drawsAllowed`,
 * and copies the run, while no restart, edit or deletion of the game can change them: a
 * recording racing a restart lands in exactly one run, the one it committed in.
 *
 * Every read in a write locks what it reads (ADR 0004); referenced rows only under a shared
 * lock, which an insert also takes for its foreign key checks.
 *
 * A new match waits for verification (PRD #61): only verified matches count in the standings,
 * on both sides at once. Its recorded rows provide Verification's port for matches.
 *
 * @phpstan-type MatchSnapshot array{game: string, first: string|null, second: string|null, outcome: string, pending: bool}
 */
final readonly class Matches implements GameDependents, PersonDependents
{
    /** The fingerprint tag of a match request: a UUID is unique across entries, matches and results. */
    private const KIND = 'match';
    private const PERSON_ERROR = 'Person nicht gefunden.';
    /** A match's two sides, each with the index of its person column. */
    private const SIDES = ['first' => 'matches_first', 'second' => 'matches_second'];
    /**
     * Matches with their game's and their persons' names, as the audit log keeps them (a cleared
     * side is null), read through the index given (`%s`) and then their references, in exactly
     * that order: a locking read locks every row it scans, so it must scan only the matches the
     * transaction holds already.
     */
    private const SNAPSHOT = 'SELECT STRAIGHT_JOIN m.id, g.name AS game, f.name AS first, s.name AS second, m.outcome, m.pending
        FROM matches m FORCE INDEX (%s) JOIN games g ON g.id = m.game_id
        LEFT JOIN persons f ON f.id = m.first_person_id LEFT JOIN persons s ON s.id = m.second_person_id';
    /** Pending matches as the pending queue lists them: their game, its run, both sides and the recorder, names as they are now. */
    private const PENDING = 'm.id, m.created_at, a.user_name AS account_name, m.game_id, g.name AS game_name, m.run < g.run AS earlier_run,
                m.first_person_id, f.name AS first_name, m.second_person_id, s.name AS second_name, m.outcome
        FROM matches m JOIN games g ON g.id = m.game_id
        LEFT JOIN persons f ON f.id = m.first_person_id LEFT JOIN persons s ON s.id = m.second_person_id
        LEFT JOIN accounts a ON a.id = m.account_id';

    public function __construct(
        private PDO $pdo,
        private Clock $clock,
        private DataRevision $revision,
        private AuditLog $audit,
        private Idempotency $idempotency,
    ) {}

    /**
     * Records a match in its game's current run, or answers the original for a UUID recorded
     * before with the same content, even after that match was undone or its game deleted.
     *
     * @param int|null    $gameId  null for a missing or non-integer field
     * @param string|null $outcome `first`, `second` or `draw`
     *
     * @throws NotFound when there is no such game
     * @throws ValidationFailed for the same person twice, a missing or unknown person, an
     *                          unknown outcome, a draw while the game allows none, or a game of another kind
     * @throws RequestConflict when the UUID was used before for other content
     */
    public function record(Actor $actor, string $id, ?int $gameId, ?int $firstPersonId, ?int $secondPersonId, ?string $outcome): RecordedMatch
    {
        $match = new DuelMatch(
            $id,
            $gameId ?? 0,
            $firstPersonId ?? 0,
            $secondPersonId ?? 0,
            self::validOutcome($firstPersonId, $secondPersonId, $outcome),
            $this->clock->now(),
        );
        $fingerprint = Idempotency::fingerprint(self::KIND, [$match->gameId, $match->firstPersonId, $match->secondPersonId, $match->outcome->value]);
        try {
            $recordedAt = $this->idempotency->write($id, $fingerprint, $match->createdAt, function () use ($match, $actor): void {
                $game = $this->rows()->lockGame($match->gameId, GameKind::Duel);
                if ($match->outcome === Outcome::Draw && !$game['drawsAllowed']) {
                    throw new ValidationFailed(['outcome' => 'Remis ist in diesem Spiel nicht möglich.']);
                }
                $this->pdo->prepare(
                    'INSERT INTO matches (id, game_id, first_person_id, second_person_id, outcome, run, account_id, created_at, pending)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)',
                )->execute([
                    $match->id,
                    $match->gameId,
                    $match->firstPersonId,
                    $match->secondPersonId,
                    $match->outcome->value,
                    $game['run'],
                    $actor->accountId,
                    Timestamp::of($match->createdAt),
                ]);
                $this->audit->record($actor, AuditOperation::Create, AuditSubjectKind::Match, $match->id, null, $this->rows()->snapshot($match->id));
            });
        } catch (PDOException $failure) {
            throw DatabaseError::is($failure, DatabaseError::MISSING_PARENT) ? $this->missingPersons($match, $failure) : $failure;
        }

        return $recordedAt === null
            ? new RecordedMatch($match, true)
            : new RecordedMatch(
                new DuelMatch($id, $match->gameId, $match->firstPersonId, $match->secondPersonId, $match->outcome, $recordedAt),
                false,
            );
    }

    /**
     * Deletes a match (undo). Its UUID stays known, so a late retry of its recording replays
     * instead of recording it again. The match is locked before its game and persons; see
     * RecordedRows::undo for how that meets a game's or a person's deletion.
     *
     * @throws NotFound when there is no such match
     */
    public function delete(Actor $actor, string $id): void
    {
        $this->rows()->undo($actor, $id);
    }

    /**
     * A duel game's ranking in its current run or an interval: every person with a verified
     * match in it, by points (win 1, draw ½, loss 0), then wins, then name, then id. Across
     * runs it simply accumulates: each verified match adds its result to both its players once.
     * Only verified matches count (PRD #61); each person names their pending matches in the
     * selection, and a person whose matches in it all wait is listed apart, unranked. It is
     * computed from each match's stored outcome, so a side that was cleared (a deleted person)
     * counts for no one and never changes the other side's result.
     *
     * @return Standings<DuelRow>
     */
    public function standings(Game $game, Interval|CurrentRun $selection): Standings
    {
        [$condition, $parameters] = $game->rowsIn($selection);
        $statement = $this->pdo->prepare(
            "SELECT p.id, p.name,
                    SUM(IF(r.pending = 0, CASE r.result WHEN 'win' THEN 1 WHEN 'draw' THEN 0.5 ELSE 0 END, 0)) AS points,
                    SUM(r.pending = 0 AND r.result = 'win') AS wins, SUM(r.pending = 0 AND r.result = 'draw') AS draws,
                    SUM(r.pending = 0 AND r.result = 'loss') AS losses, SUM(r.pending = 0) AS played, SUM(r.pending = 1) AS pending_matches
             FROM " . self::sides($condition) . "
             GROUP BY p.id, p.name
             ORDER BY SUM(r.pending = 0) = 0, points DESC, wins DESC, p.name, p.id",
        );
        $statement->execute([...$parameters, ...$parameters]);
        /** @var list<array<string, scalar|null>> $rows */
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC);
        $ranked = [];
        $unranked = [];
        foreach ($rows as $row) {
            if ((int) $row['played'] === 0) {
                $unranked[] = new UnrankedPlayer((int) $row['id'], (string) $row['name'], (int) $row['pending_matches']);
            } else {
                $ranked[] = new DuelRow(
                    (int) $row['id'],
                    (string) $row['name'],
                    (string) $row['points'],
                    (int) $row['wins'],
                    (int) $row['draws'],
                    (int) $row['losses'],
                    (int) $row['played'],
                    (int) $row['pending_matches'],
                );
            }
        }

        return new Standings($ranked, $unranked);
    }

    /**
     * The days the duel game was played: the start instants, ascending, of the 15-minute UTC
     * buckets with a verified match of any run, by its recording instant. A match counts once,
     * whether one or both of its sides still name a person; once neither does, it counts for
     * no one, as in the ranking.
     *
     * @return list<DateTimeImmutable>
     */
    public function days(int $gameId): array
    {
        return QuarterHours::of($this->pdo, self::sides('game_id = ?'), 'r.created_at', 'r.pending = 0', [$gameId, $gameId]);
    }

    /**
     * A page of a duel game's Verlauf: its matches of one run, newest first, with each side's
     * person (null once deleted), the recording account's name (null once deleted) and whether
     * the match waits for verification; pending matches are listed and marked.
     *
     * @param string|null $before the `next` of the previous page; null for the newest page of the current run
     *
     * @return HistoryPage<MatchItem>
     *
     * @throws NotFound         when the game is a points game
     * @throws ValidationFailed for a `before` that names no page or a limit outside 1–100
     */
    public function history(Game $game, ?string $before, int $limit): HistoryPage
    {
        return (new GameHistory($this->pdo))->page(
            $game,
            GameKind::Duel,
            'SELECT h.id, h.created_at, h.outcome, h.first_person_id, f.name AS first_name,
                    h.second_person_id, s.name AS second_name, a.user_name AS account_name, h.pending
             FROM matches h FORCE INDEX (matches_game)
             LEFT JOIN persons f ON f.id = h.first_person_id LEFT JOIN persons s ON s.id = h.second_person_id
             LEFT JOIN accounts a ON a.id = h.account_id',
            $before,
            $limit,
            self::itemOf(...),
        );
    }

    /** How many matches of every run belong to the game; read without locks, for the delete dialog. */
    public function count(int $gameId): int
    {
        $statement = $this->pdo->prepare('SELECT COUNT(*) FROM matches WHERE game_id = ?');
        $statement->execute([$gameId]);

        return (int) $statement->fetchColumn();
    }

    /**
     * Locks the game's matches of every run for update, then records each one's deletion,
     * caused by the game's, with its names as they are now. The game row is locked already,
     * so no match can be recorded for the game until its deletion ends.
     */
    public function recordRemoval(Actor $actor, int $gameId, int $cause): void
    {
        $this->rows()->recordDeletions($actor, $cause, 'matches_game', 'game_id', $gameId);
    }

    /** How many matches name the person on either side; read without locks, for the delete dialog. */
    public function countOfPerson(int $personId): PersonDependentCounts
    {
        $statement = $this->pdo->prepare('SELECT COUNT(*) FROM matches WHERE first_person_id = ? OR second_person_id = ?');
        $statement->execute([$personId, $personId]);

        return new PersonDependentCounts(matches: (int) $statement->fetchColumn());
    }

    /**
     * Locks the matches that name the person on either side for update, then records one
     * update per match in match id order, caused by the person's deletion: before still names
     * the person, after has that side cleared, as the foreign key will leave it. The person
     * row is locked already, so no match can be recorded for the person until the deletion ends.
     */
    public function recordPersonDeletion(Actor $actor, int $personId, int $cause): void
    {
        // Each side through its own index, so the locks cover exactly the person's matches.
        $rows = $this->rows();
        foreach (self::SIDES as $side => $index) {
            $rows->lockReferencing($index, "{$side}_person_id", $personId);
        }
        $changes = [];
        foreach (self::SIDES as $side => $index) {
            foreach ($rows->snapshots($index, "{$side}_person_id", $personId) as [$id, $before]) {
                $changes[$id] = [$id, $before, [...$before, $side => null]];
            }
        }
        ksort($changes, SORT_STRING);
        $this->audit->recordCaused($actor, $cause, AuditOperation::Update, AuditSubjectKind::Match, array_values($changes));
    }

    /**
     * The selected matches as the ranking counts them, `r` joined with its person `p`: one row
     * per side that names a person, with that side's result (`win`, `draw`, `loss`), whether
     * the match waits and its recording instant. `$selection` filters the matches, without
     * `WHERE`; its placeholders are bound twice, once per side. The ranking and the days read
     * both start here, so they cannot drift apart.
     */
    private static function sides(string $selection): string
    {
        return "(
                 SELECT first_person_id AS person_id, pending, created_at,
                        CASE outcome WHEN 'first' THEN 'win' WHEN 'second' THEN 'loss' ELSE 'draw' END AS result
                 FROM matches WHERE {$selection} AND first_person_id IS NOT NULL
                 UNION ALL
                 SELECT second_person_id, pending, created_at,
                        CASE outcome WHEN 'second' THEN 'win' WHEN 'first' THEN 'loss' ELSE 'draw' END
                 FROM matches WHERE {$selection} AND second_person_id IS NOT NULL
             ) r JOIN persons p ON p.id = r.person_id";
    }

    /**
     * The checks that need no database: two persons, and they differ; an outcome the API knows.
     *
     * @throws ValidationFailed
     */
    private static function validOutcome(?int $firstPersonId, ?int $secondPersonId, ?string $outcome): Outcome
    {
        $errors = array_filter([
            'firstPersonId' => $firstPersonId === null ? self::PERSON_ERROR : null,
            'secondPersonId' => $secondPersonId === null ? self::PERSON_ERROR : ($secondPersonId === $firstPersonId ? 'Zwei verschiedene Personen.' : null),
        ]);
        $valid = Outcome::tryFrom($outcome ?? '');
        if ($valid === null) {
            $errors['outcome'] = 'Sieg des Ersten, des Zweiten oder Remis.';
        }

        return $errors === [] && $valid !== null ? $valid : throw new ValidationFailed($errors);
    }

    /** The matches as Verification reaches them (PRD #61); the composition root wires it. */
    public function verifiableRows(): VerifiableRows
    {
        return $this->rows();
    }

    /**
     * The mechanics matches share with results, over the matches table.
     *
     * @return RecordedRows<MatchSnapshot>
     */
    private function rows(): RecordedRows
    {
        return new RecordedRows(
            $this->pdo,
            $this->revision,
            $this->audit,
            AuditSubjectKind::Match,
            'matches',
            self::SNAPSHOT,
            'm',
            self::snapshotOf(...),
            new PendingRead(VerifiableKind::Match, self::PENDING, self::pendingOf(...)),
        );
    }

    /**
     * @param array<string, scalar|null> $row
     */
    private static function pendingOf(array $row): PendingMatch
    {
        return new PendingMatch(
            (int) $row['game_id'],
            (string) $row['game_name'],
            (int) $row['earlier_run'] === 1,
            self::personOf($row['first_person_id'], $row['first_name']),
            self::personOf($row['second_person_id'], $row['second_name']),
            Outcome::from((string) $row['outcome']),
        );
    }

    /**
     * @param array<string, scalar|null> $row
     *
     * @return MatchSnapshot
     */
    private static function snapshotOf(array $row): array
    {
        return [
            'game' => (string) $row['game'],
            'first' => $row['first'] === null ? null : (string) $row['first'],
            'second' => $row['second'] === null ? null : (string) $row['second'],
            'outcome' => (string) $row['outcome'],
            'pending' => (int) $row['pending'] === 1,
        ];
    }

    /**
     * @param array<string, scalar|null> $row
     */
    private static function itemOf(array $row): MatchItem
    {
        return new MatchItem(
            (string) $row['id'],
            self::personOf($row['first_person_id'], $row['first_name']),
            self::personOf($row['second_person_id'], $row['second_name']),
            Outcome::from((string) $row['outcome']),
            GameHistory::instant($row['created_at']),
            $row['account_name'] === null ? null : (string) $row['account_name'],
            (int) $row['pending'] === 1,
        );
    }

    /** A match's side as the Verlauf shows it: null once its person was deleted. */
    private static function personOf(bool|float|int|string|null $id, bool|float|int|string|null $name): ?PersonRef
    {
        return $id === null ? null : new PersonRef((int) $id, (string) $name);
    }

    /** A refused insert as the persons it names that do not exist; the game is locked, so it is not the one missing. */
    private function missingPersons(DuelMatch $match, PDOException $failure): ValidationFailed|PDOException
    {
        $statement = $this->pdo->prepare('SELECT id FROM persons WHERE id IN (?, ?)');
        $statement->execute([$match->firstPersonId, $match->secondPersonId]);
        $existing = array_map(static fn(mixed $id): int => is_numeric($id) ? (int) $id : 0, $statement->fetchAll(PDO::FETCH_COLUMN));
        $missing = array_filter([
            'firstPersonId' => in_array($match->firstPersonId, $existing, true) ? null : self::PERSON_ERROR,
            'secondPersonId' => in_array($match->secondPersonId, $existing, true) ? null : self::PERSON_ERROR,
        ]);

        return $missing === [] ? $failure : new ValidationFailed($missing);
    }
}
