<?php

declare(strict_types=1);

namespace Performance\Domain;

use DateTimeImmutable;

/**
 * One entry of a person's history: the drink and the factor with their current
 * names (the factor null when there was none or it was deleted), and the name of
 * the account that logged it (null once that account is deleted).
 */
final readonly class HistoryEntry
{
    public function __construct(
        public string $id,
        public int $drinkId,
        public string $drinkName,
        public int $quantity,
        public ?HistoryFactor $factor,
        public DateTimeImmutable $createdAt,
        public ?string $accountName,
    ) {}
}
