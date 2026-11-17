<?php

declare(strict_types=1);

namespace Performance\Domain;

/**
 * The SQL that selects one owner's part of an account's pending queue, the same for every
 * kind: the pending rows the account may verify (those another account or one deleted since
 * recorded), from where the bound says on, newest first and then by id. Each owner puts it
 * after its own SELECT under its table's alias; `where()` and `parameters()` go together.
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

    /** The condition for the table aliased `$alias`, without `WHERE`. */
    public function where(string $alias): string
    {
        $eligible = "{$alias}.pending = 1 AND ({$alias}.account_id IS NULL OR {$alias}.account_id <> ?)";

        return $eligible . match (true) {
            $this->bound === null => '',
            $this->bound->afterId === null => " AND {$alias}.created_at < ?",
            default => " AND ({$alias}.created_at < ? OR ({$alias}.created_at = ? AND {$alias}.id > ?))",
        };
    }

    /**
     * The parameters of `where()`, in order.
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

    /** The queue's order and the page size for the table aliased `$alias`. */
    public function orderBy(string $alias, int $limit): string
    {
        return " ORDER BY {$alias}.created_at DESC, {$alias}.id LIMIT {$limit}";
    }
}
