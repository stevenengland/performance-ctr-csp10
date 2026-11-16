<?php

declare(strict_types=1);

namespace Performance\Domain\Games;

/** A person's standing in a points game's run: the sum of their points and how many results make it up. */
final readonly class PointsRow
{
    public function __construct(
        public int $personId,
        public string $name,
        public int $sum,
        public int $results,
    ) {}
}
