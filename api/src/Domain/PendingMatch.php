<?php

declare(strict_types=1);

namespace Performance\Domain;

use Performance\Domain\Games\Outcome;
use Performance\Domain\Games\PersonRef;

/**
 * What a pending match is about, as the pending queue shows it: its game, whether it belongs to
 * an earlier run of that game (verifying it then leaves the current standings as they are), its
 * two sides (a side is null once that person was deleted) and its outcome; names as they are now.
 */
final readonly class PendingMatch
{
    public function __construct(
        public int $gameId,
        public string $gameName,
        public bool $earlierRun,
        public ?PersonRef $first,
        public ?PersonRef $second,
        public Outcome $outcome,
    ) {}
}
