<?php

declare(strict_types=1);

namespace Performance\Domain\Games;

use DateTimeImmutable;

/**
 * One match of a game's Verlauf: its two persons (a side is null once that person was
 * deleted), its outcome, when it was recorded and by which account (null once that account
 * was deleted), and whether it still waits for verification.
 */
final readonly class MatchItem
{
    public function __construct(
        public string $id,
        public ?PersonRef $first,
        public ?PersonRef $second,
        public Outcome $outcome,
        public DateTimeImmutable $createdAt,
        public ?string $accountName,
        public bool $pending,
    ) {}
}
