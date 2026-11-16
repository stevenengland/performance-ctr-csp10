<?php

declare(strict_types=1);

namespace Performance\Domain\Games;

/**
 * A person's standing in a duel game's run: points (win 1, draw ½, loss 0) as an exact
 * decimal string, e.g. `2.5`, and the matches won, drawn, lost and played.
 */
final readonly class DuelRow
{
    public function __construct(
        public int $personId,
        public string $name,
        public string $points,
        public int $wins,
        public int $draws,
        public int $losses,
        public int $played,
    ) {}
}
