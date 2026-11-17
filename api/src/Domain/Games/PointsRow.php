<?php

declare(strict_types=1);

namespace Performance\Domain\Games;

/**
 * A person's standing in a points game's selection: the sum of their verified points, how many
 * verified results make it up (at least one: a person without one is unranked), and how many
 * of the person's results in the selection still wait for verification. The average per result
 * is the exact quotient of the two whole numbers; it is compared and rounded without dividing.
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

    /** Orders by the exact average per result, lowest first, by cross-multiplying: no rounded quotient decides. */
    public function compareAverage(self $other): int
    {
        return $this->sum * $other->results <=> $other->sum * $this->results;
    }

    /** The average per result in tenths, rounded half away from zero from the exact quotient. */
    public function averageTenths(): int
    {
        return intdiv(20 * $this->sum + ($this->sum < 0 ? -$this->results : $this->results), 2 * $this->results);
    }
}
