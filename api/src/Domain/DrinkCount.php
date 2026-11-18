<?php

declare(strict_types=1);

namespace Performance\Domain;

/**
 * A person's counters for one drink in a day window, each Σ quantity × multiplier: `count` over
 * the verified entries, which rank, and `recordedCount` over every recorded entry, pending
 * included, which the recording flow shows. `rawCount` and `rawRecordedCount` are their pure
 * counterparts, Σ quantity over the same entries without their factors.
 */
final readonly class DrinkCount
{
    public function __construct(
        public int $drinkId,
        public string $name,
        public string $count,
        public string $recordedCount,
        public string $rawCount,
        public string $rawRecordedCount,
    ) {}
}
