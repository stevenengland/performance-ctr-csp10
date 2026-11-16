<?php

declare(strict_types=1);

namespace Performance\Domain;

/**
 * What a person's deletion does to the rows of other modules that name the person (a duel's
 * matches keep their row with that side cleared; a points game's results go with the
 * person). The catalog asks through this port and never reads those tables itself; the
 * composition root wires one CompositePersonDependents.
 */
interface PersonDependents
{
    /** How many rows of each kind name the person. Advisory, for the delete dialog: read without locks. */
    public function countOfPerson(int $personId): PersonDependentCounts;

    /**
     * Before a person is deleted: locks the rows that name the person, reads them and records
     * in the audit log what the deletion does to each, caused by `$cause`. Runs in the
     * deletion's transaction, after the person row is locked for update and its own deletion
     * recorded as `$cause`; the foreign keys then make the change together with the person's
     * deletion.
     */
    public function recordPersonDeletion(Actor $actor, int $personId, int $cause): void;
}
