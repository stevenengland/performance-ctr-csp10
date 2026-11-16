<?php

declare(strict_types=1);

namespace Performance\Domain\Games;

use DateTimeImmutable;

/**
 * One match of a duel game as it was recorded: the client's UUID, the game, the first and the
 * second person, and how it ended. (`Match` is a reserved word in PHP.)
 */
final readonly class DuelMatch
{
    public function __construct(
        public string $id,
        public int $gameId,
        public int $firstPersonId,
        public int $secondPersonId,
        public Outcome $outcome,
        public DateTimeImmutable $createdAt,
    ) {}
}
