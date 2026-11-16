<?php

declare(strict_types=1);

namespace Performance\Domain\Catalog;

final readonly class Factor
{
    /**
     * @param string $multiplier a decimal with two places, e.g. `1.50`
     */
    public function __construct(
        public int $id,
        public string $name,
        public string $multiplier,
    ) {}
}
