<?php

declare(strict_types=1);

namespace Performance\Domain;

/**
 * One page of an account's pending queue, where the next one starts, and how many rows the
 * account may verify in all, whatever page this is.
 */
final readonly class PendingPage
{
    /**
     * @param list<PendingItem> $items in queue order
     * @param string|null       $next  the cursor of the next page; null on the last one
     */
    public function __construct(
        public array $items,
        public ?string $next,
        public int $count,
    ) {}
}
