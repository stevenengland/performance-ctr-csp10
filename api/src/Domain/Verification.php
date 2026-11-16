<?php

declare(strict_types=1);

namespace Performance\Domain;

use LogicException;

/**
 * The four-eyes rule (PRD #61): a row that waits for verification counts once an account other
 * than its recorder verifies it; a row whose recorder was deleted may be verified by anyone.
 *
 * Verification owns the transaction and the audit event; the rows themselves stay with their
 * owners, which it reaches only through their VerifiableRows port. It decides under the row's
 * lock, never from an unlocked read: of concurrent verifications of one row exactly one records
 * the event and bumps the data revision, and every other, like every later repeat, succeeds
 * without either.
 */
final readonly class Verification
{
    /** Rows per page of the pending queue. */
    public const PAGE_SIZE = 20;

    /**
     * @param array<value-of<VerifiableKind>, VerifiableRows> $owners each kind's row owner
     */
    public function __construct(
        private DataRevision $revision,
        private AuditLog $audit,
        private Clock $clock,
        private array $owners,
    ) {}

    /**
     * Lets a pending row count. A row that counts already stays as it is: nothing is recorded
     * and the revision stays.
     *
     * @throws NotFound when there is no such row
     * @throws OwnRow   when the acting account recorded it
     */
    public function verify(Actor $actor, VerifiableKind $kind, string $id): void
    {
        $rows = $this->owner($kind);
        $this->revision->writeIfChanged(function () use ($actor, $kind, $id, $rows): bool {
            $row = self::lockedFor($actor, $rows, $id);
            if (!$row->pending) {
                return false;
            }
            $after = $rows->markVerified($id, $actor->accountId, $this->clock->now());
            $this->audit->record($actor, AuditOperation::Verify, $kind->subjectKind(), $id, $row->snapshot, $after);

            return true;
        });
    }

    /**
     * The rows the account may verify, of every kind and every day, a page at a time in one
     * order: recording instant descending, then kind, then id. A page goes on after the last
     * row of the one before, so rows handled meanwhile never make later rows unreachable;
     * `count` covers all of them, whatever the page. Read it in a Snapshot, so items and count
     * agree with each other and with the data revision.
     *
     * @param string|null $cursor the `next` of the previous page; null for the first page
     *
     * @throws ValidationFailed when `$cursor` names no position in the queue
     */
    public function queue(int $accountId, ?string $cursor, int $limit = self::PAGE_SIZE): PendingPage
    {
        $after = $cursor === null ? null : QueueCursor::of($cursor);
        if ($cursor !== null && $after === null) {
            throw new ValidationFailed(['cursor' => 'Unbekannte Seite.']);
        }
        $items = [];
        $count = 0;
        foreach (VerifiableKind::cases() as $kind) {
            $rows = $this->owner($kind);
            // One more than the page holds tells whether a next page exists.
            array_push($items, ...$rows->pending($accountId, $after?->boundFor($kind), $limit + 1));
            $count += $rows->countPending($accountId);
        }
        usort($items, QueueCursor::compare(...));
        $page = array_slice($items, 0, $limit);
        $last = end($page);

        return new PendingPage($page, count($items) > $limit && $last !== false ? QueueCursor::after($last)->token() : null, $count);
    }

    /**
     * Locks the row for a decision of the actor.
     *
     * @throws NotFound when there is no such row
     * @throws OwnRow   when the actor recorded it
     */
    private static function lockedFor(Actor $actor, VerifiableRows $rows, string $id): VerifiableRow
    {
        $row = $rows->lock($id);
        if ($row === null) {
            throw new NotFound($id);
        }
        if ($row->recorderAccountId === $actor->accountId) {
            throw new OwnRow($id);
        }

        return $row;
    }

    private function owner(VerifiableKind $kind): VerifiableRows
    {
        return $this->owners[$kind->value] ?? throw new LogicException("No owner provides the {$kind->value} rows");
    }
}
