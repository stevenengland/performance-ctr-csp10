<?php

declare(strict_types=1);

namespace Performance\Domain\Games;

/** A person a Verlauf row names, with their current name. */
final readonly class PersonRef
{
    public function __construct(
        public int $id,
        public string $name,
    ) {}
}
