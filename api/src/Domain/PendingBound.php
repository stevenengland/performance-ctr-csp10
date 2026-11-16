<?php

declare(strict_types=1);

namespace Performance\Domain;

use DateTimeImmutable;

/**
 * Where one owner's part of the pending queue goes on after a page: the rows recorded before
 * `createdAt`, and, unless `afterId` is null, also the rows recorded at `createdAt` whose id
 * sorts after `afterId` (every id sorts after '').
 */
final readonly class PendingBound
{
    public function __construct(
        public DateTimeImmutable $createdAt,
        public ?string $afterId,
    ) {}
}
