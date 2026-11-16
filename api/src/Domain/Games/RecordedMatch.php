<?php

declare(strict_types=1);

namespace Performance\Domain\Games;

/** The answer to recording a match: the match, and whether this request recorded it or replayed an earlier one. */
final readonly class RecordedMatch
{
    public function __construct(
        public DuelMatch $match,
        public bool $created,
    ) {}
}
