<?php

declare(strict_types=1);

namespace Performance\Domain;

/**
 * The drink standings of a day window: the ranked persons, who have at least one verified
 * entry in it, and the unranked ones, whose entries in it all wait for verification.
 */
final readonly class DrinkStandings
{
    /**
     * @param list<ScoreRow>    $rows     ranked by score, ties by name
     * @param list<UnrankedRow> $unranked by name
     */
    public function __construct(
        public array $rows,
        public array $unranked,
    ) {}
}
