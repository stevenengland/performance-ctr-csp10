<?php

declare(strict_types=1);

namespace Performance\Domain;

use DateTimeImmutable;

/**
 * One row of the pending queue, tagged with its kind: when it was recorded, by whom (null once
 * that account was deleted), and what it is about, in the shape of its kind (an entry's details
 * for `entry`, a match's for `match`).
 */
final readonly class PendingItem
{
    public function __construct(
        public VerifiableKind $kind,
        public string $id,
        public DateTimeImmutable $createdAt,
        public ?string $accountName,
        public PendingEntry|PendingMatch $details,
    ) {}
}
