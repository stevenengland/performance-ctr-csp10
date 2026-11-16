<?php

declare(strict_types=1);

namespace Performance\Domain\Catalog;

final readonly class Person
{
    public function __construct(
        public int $id,
        public string $name,
    ) {}
}
