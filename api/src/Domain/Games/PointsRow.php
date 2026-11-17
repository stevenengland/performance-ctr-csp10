<?php

declare(strict_types=1);

namespace Performance\Domain\Games;

/**
 * A person's standing in a points game's run: the sum of their verified points, how many
 * verified results make it up, and how many of the person's results in the run still wait for
 * verification.
 */
final readonly class PointsRow
{
    public function __construct(
        public int $personId,
        public string $name,
        public int $sum,
        public int $results,
        public int $pendingCount,
    ) {}
}
