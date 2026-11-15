<?php

declare(strict_types=1);

namespace Performance\Domain\Catalog;

final readonly class Drink
{
    /**
     * @param string $points alcohol base points as a decimal with two places, e.g. `1.50`
     */
    public function __construct(
        public int $id,
        public string $name,
        public string $points,
    ) {}
}
