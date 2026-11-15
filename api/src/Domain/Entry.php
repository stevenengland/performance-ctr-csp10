<?php

declare(strict_types=1);

namespace Performance\Domain;

use DateTimeImmutable;

/** One add of the entry log: a quantity of a drink for a person, at a server instant. */
final readonly class Entry
{
    public function __construct(
        public string $id,
        public int $personId,
        public int $drinkId,
        public int $quantity,
        public DateTimeImmutable $createdAt,
    ) {}
}
