<?php

declare(strict_types=1);

namespace Performance\Domain;

/** The factor of a history entry, with its current name and multiplier. */
final readonly class HistoryFactor
{
    public function __construct(
        public int $id,
        public string $name,
        public string $multiplier,
    ) {}
}
