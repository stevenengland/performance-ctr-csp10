<?php

declare(strict_types=1);

namespace Performance\Domain;

use DateTimeImmutable;

/**
 * The port a row owner (the entry ledger; matches and results through their recorded rows)
 * provides to Verification (PRD #61). Every operation runs inside the transaction Verification
 * opened: it never commits, never bumps the data revision and never records an audit event.
 * Locks on referenced rows and the snapshot's shape stay with the owner.
 */
interface VerifiableRows
{
    /**
     * Locks the row for update, before anything it references, in the same order as the
     * owner's undo, and reads it.
     *
     * @return VerifiableRow|null null when there is no such row
     */
    public function lock(string $id): ?VerifiableRow;

    /**
     * Marks the row `lock` returned as verified at `$at` by the account, and returns its audit
     * snapshot after that. An account deleted meanwhile is recorded as unknown, as its
     * deletion would have cleared it a moment later.
     *
     * @return array<string, mixed>
     */
    public function markVerified(string $id, int $accountId, DateTimeImmutable $at): array;
}
