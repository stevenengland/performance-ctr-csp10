<?php

declare(strict_types=1);

namespace Performance\Domain\Games;

use Closure;
use LogicException;
use PDO;
use Performance\Domain\Actor;
use Performance\Domain\AuditLog;
use Performance\Domain\AuditOperation;
use Performance\Domain\AuditSubjectKind;
use Performance\Domain\DataRevision;
use Performance\Domain\NotFound;
use Performance\Domain\ValidationFailed;

/**
 * What matches and results share as rows recorded in a game's run: locking the game for a
 * recording, undoing a row, reading a row's audit snapshot, and recording the deletions that a
 * game's or a person's deletion brings about. Each module keeps its own table, snapshot and
 * rules; this holds the lock order and the audit protocol, so both follow them the same way.
 *
 * Every read in a write locks what it reads (ADR 0004); referenced rows only under a shared
 * lock, which an insert also takes for its foreign key checks.
 *
 * @template TSnapshot of array<string, mixed>
 */
final readonly class RecordedRows
{
    /**
     * @param 'matches'|'results'                            $table
     * @param string                                         $snapshotSelect the rows with their game's and persons' names as the audit log keeps them,
     *                                                                       read through the index given (`%s`) and then their references, in exactly
     *                                                                       that order: a locking read locks every row it scans, so it must scan only
     *                                                                       the rows the transaction holds already
     * @param 'm'|'r'                                        $alias          the table's alias in `$snapshotSelect`
     * @param Closure(array<string, scalar|null>): TSnapshot $snapshotOf     one row of `$snapshotSelect` as the audit log keeps it
     */
    public function __construct(
        private PDO $pdo,
        private DataRevision $revision,
        private AuditLog $audit,
        private AuditSubjectKind $subjectKind,
        private string $table,
        private string $snapshotSelect,
        private string $alias,
        private Closure $snapshotOf,
    ) {}

    /**
     * Locks the game row for share for the rest of a recording and checks that it is a game of
     * the kind: no restart, edit or deletion of the game can change it until the recording
     * commits, so the recording lands in exactly the run it read.
     *
     * @return array{drawsAllowed: bool, run: int} the game's duel setting and current run
     *
     * @throws NotFound         when there is no such game
     * @throws ValidationFailed for a game of another kind
     */
    public function lockGame(int $gameId, GameKind $kind): array
    {
        $statement = $this->pdo->prepare('SELECT kind, draws_allowed, run FROM games WHERE id = ? LOCK IN SHARE MODE');
        $statement->execute([$gameId]);
        /** @var array{kind: string, draws_allowed: int|string, run: int|string}|false $game */
        $game = $statement->fetch(PDO::FETCH_ASSOC);
        if ($game === false) {
            throw new NotFound((string) $gameId);
        }
        if ($game['kind'] !== $kind->value) {
            throw new ValidationFailed(['gameId' => $kind === GameKind::Duel ? 'Kein Duell.' : 'Kein Punktespiel.']);
        }

        return ['drawsAllowed' => (bool) $game['draws_allowed'], 'run' => (int) $game['run']];
    }

    /**
     * Deletes a row (undo) with its audit event. Its UUID stays known, so a late retry of its
     * recording replays instead of recording it again.
     *
     * The row is locked before its game and persons, which a game's or a person's deletion
     * lock before their rows; when the two deadlock, DataRevision runs the loser again, which
     * then finds the other's result.
     *
     * @throws NotFound when there is no such row
     */
    public function undo(Actor $actor, string $id): void
    {
        $this->revision->write(function () use ($actor, $id): void {
            $locked = $this->pdo->prepare("SELECT id FROM {$this->table} WHERE id = ? FOR UPDATE");
            $locked->execute([$id]);
            if ($locked->fetchColumn() === false) {
                throw new NotFound($id);
            }
            $this->audit->record($actor, AuditOperation::Delete, $this->subjectKind, $id, $this->snapshot($id), null);
            $this->pdo->prepare("DELETE FROM {$this->table} WHERE id = ?")->execute([$id]);
        });
    }

    /**
     * One row the transaction holds already, as the audit log keeps it.
     *
     * @return TSnapshot
     */
    public function snapshot(string $id): array
    {
        $statement = $this->pdo->prepare(sprintf($this->snapshotSelect, 'PRIMARY') . " WHERE {$this->alias}.id = ? LOCK IN SHARE MODE");
        $statement->execute([$id]);
        /** @var array<string, scalar|null>|false $row */
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        if ($row === false) {
            throw new LogicException("{$this->subjectKind->value} {$id} is not there to be recorded");
        }

        return ($this->snapshotOf)($row);
    }

    /**
     * Locks the rows whose `$column` is `$id` for update through `$index`. The index is forced
     * so the locks cover exactly those rows, whatever the optimizer would pick on a small table.
     *
     * @return bool whether there are any
     */
    public function lock(string $index, string $column, int $id): bool
    {
        $locked = $this->pdo->prepare("SELECT id FROM {$this->table} FORCE INDEX ({$index}) WHERE {$column} = ? FOR UPDATE");
        $locked->execute([$id]);

        return $locked->fetchAll(PDO::FETCH_COLUMN) !== [];
    }

    /**
     * The rows whose `$column` is `$id`, locked by `lock()` already, each with its snapshot, in
     * id order.
     *
     * @return list<array{string, TSnapshot}>
     */
    public function snapshots(string $index, string $column, int $id): array
    {
        $statement = $this->pdo->prepare(
            sprintf($this->snapshotSelect, $index) . " WHERE {$this->alias}.{$column} = ? ORDER BY {$this->alias}.id LOCK IN SHARE MODE",
        );
        $statement->execute([$id]);
        /** @var list<array<string, scalar|null>> $rows */
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC);

        return array_map(fn(array $row): array => [(string) $row['id'], ($this->snapshotOf)($row)], $rows);
    }

    /**
     * Locks the rows whose `$column` is `$id`, then records one delete per row in id order,
     * caused by `$cause`, with its names as they are now; the foreign key then removes them.
     */
    public function recordDeletions(Actor $actor, int $cause, string $index, string $column, int $id): void
    {
        if (!$this->lock($index, $column, $id)) {
            return;
        }
        $this->audit->recordCaused(
            $actor,
            $cause,
            AuditOperation::Delete,
            $this->subjectKind,
            array_map(static fn(array $row): array => [$row[0], $row[1], null], $this->snapshots($index, $column, $id)),
        );
    }
}
