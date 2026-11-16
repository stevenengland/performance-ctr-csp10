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
 * @phpstan-type MatchSnapshot array{game: string, first: string|null, second: string|null, outcome: string}
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
    private const SNAPSHOT = 'SELECT STRAIGHT_JOIN m.id, g.name AS game, f.name AS first, s.name AS second, m.outcome
        FROM matches m FORCE INDEX (%s) JOIN games g ON g.id = m.game_id
        LEFT JOIN persons f ON f.id = m.first_person_id LEFT JOIN persons s ON s.id = m.second_person_id';

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
                $run = $this->lockGameForRecording($match->gameId, $match->outcome);
                $this->pdo->prepare(
                    'INSERT INTO matches (id, game_id, first_person_id, second_person_id, outcome, run, account_id, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                )->execute([
                    $match->id,
                    $match->gameId,
                    $match->firstPersonId,
                    $match->secondPersonId,
                    $match->outcome->value,
                    $run,
                    $actor->accountId,
                    Timestamp::of($match->createdAt),
                ]);
                $this->audit->record($actor, AuditOperation::Create, AuditSubjectKind::Match, $match->id, null, $this->snapshot($match->id));
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
     * instead of recording it again.
     *
     * The match is locked before its game and persons, which a game deletion locks before its
     * matches; when the two deadlock, DataRevision runs the loser again, which then finds the
     * other's result.
     *
     * @throws NotFound when there is no such match
     */
    public function delete(Actor $actor, string $id): void
    {
        $this->revision->write(function () use ($actor, $id): void {
            $locked = $this->pdo->prepare('SELECT id FROM matches WHERE id = ? FOR UPDATE');
            $locked->execute([$id]);
            if ($locked->fetchColumn() === false) {
                throw new NotFound($id);
            }
            $this->audit->record($actor, AuditOperation::Delete, AuditSubjectKind::Match, $id, $this->snapshot($id), null);
            $this->pdo->prepare('DELETE FROM matches WHERE id = ?')->execute([$id]);
        });
    }

    /**
     * A duel game's ranking in one run: every person with a match in it, by points (win 1,
     * draw ½, loss 0), then wins, then name, then id. It is computed from each match's stored
     * outcome, so a side that was cleared (a deleted person) counts for no one and never
     * changes the other side's result.
     *
     * @return list<DuelRow>
     */
    public function standings(int $gameId, int $run): array
    {
        $statement = $this->pdo->prepare(
            "SELECT p.id, p.name,
                    SUM(CASE r.result WHEN 'win' THEN 1 WHEN 'draw' THEN 0.5 ELSE 0 END) AS points,
                    SUM(r.result = 'win') AS wins, SUM(r.result = 'draw') AS draws, SUM(r.result = 'loss') AS losses,
                    COUNT(*) AS played
             FROM (
                 SELECT first_person_id AS person_id,
                        CASE outcome WHEN 'first' THEN 'win' WHEN 'second' THEN 'loss' ELSE 'draw' END AS result
                 FROM matches WHERE game_id = ? AND run = ? AND first_person_id IS NOT NULL
                 UNION ALL
                 SELECT second_person_id,
                        CASE outcome WHEN 'second' THEN 'win' WHEN 'first' THEN 'loss' ELSE 'draw' END
                 FROM matches WHERE game_id = ? AND run = ? AND second_person_id IS NOT NULL
             ) r JOIN persons p ON p.id = r.person_id
             GROUP BY p.id, p.name
             ORDER BY points DESC, wins DESC, p.name, p.id",
        );
        $statement->execute([$gameId, $run, $gameId, $run]);
        /** @var list<array<string, scalar|null>> $rows */
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC);

        return array_map(
            static fn(array $row): DuelRow => new DuelRow(
                (int) $row['id'],
                (string) $row['name'],
                (string) $row['points'],
                (int) $row['wins'],
                (int) $row['draws'],
                (int) $row['losses'],
                (int) $row['played'],
            ),
            $rows,
        );
    }

    /**
     * A page of a duel game's Verlauf: its matches of one run, newest first, with each side's
     * person (null once deleted) and the recording account's name (null once deleted).
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
                    h.second_person_id, s.name AS second_name, a.user_name AS account_name
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
        // The index is forced so the locks cover exactly the game's matches, whatever the
        // optimizer would pick on a small table.
        $locked = $this->pdo->prepare('SELECT id FROM matches FORCE INDEX (matches_game) WHERE game_id = ? FOR UPDATE');
        $locked->execute([$gameId]);
        if ($locked->fetchAll(PDO::FETCH_COLUMN) === []) {
            return;
        }
        $statement = $this->pdo->prepare(sprintf(self::SNAPSHOT, 'matches_game') . ' WHERE m.game_id = ? ORDER BY m.id LOCK IN SHARE MODE');
        $statement->execute([$gameId]);
        /** @var list<array<string, scalar|null>> $rows */
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC);
        $this->audit->recordCaused(
            $actor,
            $cause,
            AuditOperation::Delete,
            AuditSubjectKind::Match,
            array_map(static fn(array $row): array => [(string) $row['id'], self::snapshotOf($row), null], $rows),
        );
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
        foreach (self::SIDES as $side => $index) {
            $this->pdo->prepare("SELECT id FROM matches FORCE INDEX ({$index}) WHERE {$side}_person_id = ? FOR UPDATE")->execute([$personId]);
        }
        $changes = [];
        foreach (self::SIDES as $side => $index) {
            $statement = $this->pdo->prepare(sprintf(self::SNAPSHOT, $index) . " WHERE m.{$side}_person_id = ? LOCK IN SHARE MODE");
            $statement->execute([$personId]);
            /** @var list<array<string, scalar|null>> $rows */
            $rows = $statement->fetchAll(PDO::FETCH_ASSOC);
            foreach ($rows as $row) {
                $before = self::snapshotOf($row);
                $changes[(string) $row['id']] = [(string) $row['id'], $before, [...$before, $side => null]];
            }
        }
        ksort($changes, SORT_STRING);
        $this->audit->recordCaused($actor, $cause, AuditOperation::Update, AuditSubjectKind::Match, array_values($changes));
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

    /**
     * Locks the game row for share for the rest of the recording and checks that the match
     * fits it.
     *
     * @return int the game's current run
     *
     * @throws NotFound when there is no such game
     * @throws ValidationFailed for a game of another kind, or a draw while the game allows none
     */
    private function lockGameForRecording(int $gameId, Outcome $outcome): int
    {
        $statement = $this->pdo->prepare('SELECT kind, draws_allowed, run FROM games WHERE id = ? LOCK IN SHARE MODE');
        $statement->execute([$gameId]);
        /** @var array{kind: string, draws_allowed: int|string, run: int|string}|false $game */
        $game = $statement->fetch(PDO::FETCH_ASSOC);
        if ($game === false) {
            throw new NotFound((string) $gameId);
        }
        if ($game['kind'] !== GameKind::Duel->value) {
            throw new ValidationFailed(['gameId' => 'Kein Duell.']);
        }
        if ($outcome === Outcome::Draw && !(bool) $game['draws_allowed']) {
            throw new ValidationFailed(['outcome' => 'Remis ist in diesem Spiel nicht möglich.']);
        }

        return (int) $game['run'];
    }

    /**
     * One match the transaction holds already, as the audit log keeps it.
     *
     * @return MatchSnapshot
     */
    private function snapshot(string $id): array
    {
        $statement = $this->pdo->prepare(sprintf(self::SNAPSHOT, 'PRIMARY') . ' WHERE m.id = ? LOCK IN SHARE MODE');
        $statement->execute([$id]);
        /** @var array<string, scalar|null>|false $row */
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        if ($row === false) {
            throw new LogicException("Match {$id} is not there to be recorded");
        }

        return self::snapshotOf($row);
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
