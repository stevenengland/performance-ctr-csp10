<?php

declare(strict_types=1);

namespace Performance\Domain\Games;

/**
 * A game's ranking in one run (PRD #61): the ranked persons, who have at least one verified
 * row in it, and the unranked ones, whose rows in it all wait for verification.
 *
 * @template TRow of DuelRow|PointsRow
 */
final readonly class Standings
{
    /**
     * @param list<TRow>           $rows     in ranking order
     * @param list<UnrankedPlayer> $unranked by name
     */
    public function __construct(
        public array $rows,
        public array $unranked,
    ) {}
}
