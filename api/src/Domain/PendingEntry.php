<?php

declare(strict_types=1);

namespace Performance\Domain;

/** What a pending entry is about, as the pending queue shows it: names as they are now. */
final readonly class PendingEntry
{
    public function __construct(
        public int $personId,
        public string $personName,
        public int $drinkId,
        public string $drinkName,
        public int $quantity,
        public ?HistoryFactor $factor,
    ) {}
}
