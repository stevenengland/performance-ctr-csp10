<?php

declare(strict_types=1);

namespace Performance\Domain\Games;

use DateTimeImmutable;

/** One person's points in a points game as they were recorded: the client's UUID, the game, the person and the points. */
final readonly class Result
{
    public function __construct(
        public string $id,
        public int $gameId,
        public int $personId,
        public int $points,
        public DateTimeImmutable $createdAt,
    ) {}
}
