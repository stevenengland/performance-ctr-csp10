<?php

declare(strict_types=1);

namespace Performance\Domain;

use Performance\Domain\Games\PersonRef;

/**
 * What a pending result is about, as the pending queue shows it: its game, whether it belongs
 * to an earlier run of that game (verifying it then leaves the current standings as they are),
 * its person and their points; names as they are now.
 */
final readonly class PendingResult
{
    public function __construct(
        public int $gameId,
        public string $gameName,
        public bool $earlierRun,
        public PersonRef $person,
        public int $points,
    ) {}
}
