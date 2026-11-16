<?php

declare(strict_types=1);

namespace Performance\Domain;

/** A person's counter for one drink in a day window. */
final readonly class DrinkCount
{
    public function __construct(
        public int $drinkId,
        public string $name,
        public string $count,
    ) {}
}
