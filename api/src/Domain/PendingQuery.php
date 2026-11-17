<?php

declare(strict_types=1);

namespace Performance\Domain;

/**
 * The SQL that selects one owner's part of an account's pending queue, the same for every
 * kind: the pending rows the account may verify (those another account or one deleted since
 * recorded), from where the bound says on, newest first and then by id. Each owner names its
 * columns and tables, its row table first under its alias; `parameters()` goes with the
 * statements of `page()` and `count()`.
 *
 * Both read the table's pending index `(pending, created_at DESC, id, account_id)`
 * (VerificationSchema): a page walks it in the queue's order and stops after the page, skipping
 * the account's own rows inside the index; a count reads only the index entries of pending
 * rows. `STRAIGHT_JOIN` keeps the row table first, so no join order makes MariaDB read the
 * whole table and sort it (measured: PendingQueuePlanTest).
 */
final readonly class PendingQuery
{
    /**
     * @param PendingBound|null $bound where the page goes on; null for the first page or a count
     */
    public function __construct(
        private int $accountId,
        private ?PendingBound $bound = null,
    ) {}

    /**
     * A page of the queue: `$from` names the columns and tables after SELECT, the row table
     * first, aliased `$alias`.
     */
    public function page(string $from, string $alias, int $limit): string
    {
        return "SELECT STRAIGHT_JOIN {$from} WHERE {$this->where($alias)} ORDER BY {$alias}.created_at DESC, {$alias}.id LIMIT {$limit}";
    }

    /** How many rows of the table are in the queue, whatever the page. */
    public function count(string $table, string $alias): string
    {
        return "SELECT COUNT(*) FROM {$table} {$alias} WHERE {$this->where($alias)}";
    }

    /** The condition for the table aliased `$alias`, without `WHERE`. */
    private function where(string $alias): string
    {
        $eligible = "{$alias}.pending = 1 AND ({$alias}.account_id IS NULL OR {$alias}.account_id <> ?)";

        return $eligible . match (true) {
            $this->bound === null => '',
            $this->bound->afterId === null => " AND {$alias}.created_at < ?",
            default => " AND ({$alias}.created_at < ? OR ({$alias}.created_at = ? AND {$alias}.id > ?))",
        };
    }

    /**
     * The parameters of `page()` and `count()`, in order.
     *
     * @return list<int|string>
     */
    public function parameters(): array
    {
        if ($this->bound === null) {
            return [$this->accountId];
        }
        $at = Timestamp::of($this->bound->createdAt);

        return $this->bound->afterId === null
            ? [$this->accountId, $at]
            : [$this->accountId, $at, $at, $this->bound->afterId];
    }
}
