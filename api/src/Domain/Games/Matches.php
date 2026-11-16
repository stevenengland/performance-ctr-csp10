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
use Performance\Domain\Idempotency;
use Performance\Domain\NotFound;
use Performance\Domain\RequestConflict;
use Performance\Domain\Timestamp;
use Performance\Domain\ValidationFailed;

/**
 * The matches of duel games, end to end: record one idempotently on the client's UUID and
 * undo it. Every write names its actor and is recorded in the audit log in its own
 * transaction, together with the data revision bump; a replay, a conflict or a failure records
 * nothing.
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
final readonly class Matches
{
    /** The fingerprint tag of a match request: a UUID is unique across entries, matches and results. */
    private const KIND = 'match';
    private const PERSON_ERROR = 'Person nicht gefunden.';
    /** A match with its game's and its persons' names, as the audit log keeps it; a cleared side is null. */
    private const SNAPSHOT = 'SELECT STRAIGHT_JOIN m.id, g.name AS game, f.name AS first, s.name AS second, m.outcome
        FROM matches m JOIN games g ON g.id = m.game_id
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
        $statement = $this->pdo->prepare(self::SNAPSHOT . ' WHERE m.id = ? LOCK IN SHARE MODE');
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

    /** A refused insert as the persons it names that do not exist; the game is locked, so it is not the one missing. */
    private function missingPersons(DuelMatch $match, PDOException $failure): ValidationFailed|PDOException
    {
        $statement = $this->pdo->prepare('SELECT id FROM persons WHERE id IN (?, ?)');
        $statement->execute([$match->firstPersonId, $match->secondPersonId]);
        $existing = array_map(intval(...), $statement->fetchAll(PDO::FETCH_COLUMN));
        $missing = array_filter([
            'firstPersonId' => in_array($match->firstPersonId, $existing, true) ? null : self::PERSON_ERROR,
            'secondPersonId' => in_array($match->secondPersonId, $existing, true) ? null : self::PERSON_ERROR,
        ]);

        return $missing === [] ? $failure : new ValidationFailed($missing);
    }
}
