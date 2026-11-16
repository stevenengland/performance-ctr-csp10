<?php

declare(strict_types=1);

namespace Performance\Domain;

/**
 * What goes with a game: the rows of another module that belong to it (a duel game's
 * matches, a points game's results), in every run. Games asks through this port and never
 * reads those tables itself; the composition root wires one CompositeGameDependents.
 */
interface GameDependents
{
    /** How many rows of every run belong to the game. Advisory, for the delete dialog: read without locks. */
    public function count(int $gameId): int;

    /**
     * Before a game is deleted: locks the rows of every run that belong to it, reads them and
     * records one delete event per row in the audit log, caused by `$cause`. Runs in the
     * deletion's transaction, after the game row is locked for update and its own deletion
     * recorded as `$cause`; the foreign keys then delete the rows together with the game.
     */
    public function recordRemoval(Actor $actor, int $gameId, int $cause): void;
}
