<?php

declare(strict_types=1);

namespace Performance\Domain\Games;

/**
 * A person whose rows in a game's run all wait for verification: listed without a rank or a
 * value, with the number of those pending rows.
 */
final readonly class UnrankedPlayer
{
    public function __construct(
        public int $personId,
        public string $name,
        public int $pendingCount,
    ) {}
}
