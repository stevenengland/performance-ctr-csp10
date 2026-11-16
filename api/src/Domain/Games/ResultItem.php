<?php

declare(strict_types=1);

namespace Performance\Domain\Games;

use DateTimeImmutable;

/**
 * One result of a game's Verlauf: the person and their points, when it was recorded and by
 * which account (null once that account was deleted).
 */
final readonly class ResultItem
{
    public function __construct(
        public string $id,
        public PersonRef $person,
        public int $points,
        public DateTimeImmutable $createdAt,
        public ?string $accountName,
    ) {}
}
