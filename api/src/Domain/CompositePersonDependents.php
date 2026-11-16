<?php

declare(strict_types=1);

namespace Performance\Domain;

/** All of a person's dependents as one: the counts add up, and each member records what the deletion does to its rows in turn. */
final readonly class CompositePersonDependents implements PersonDependents
{
    /** @var list<PersonDependents> */
    private array $members;

    public function __construct(PersonDependents ...$members)
    {
        $this->members = array_values($members);
    }

    public function countOfPerson(int $personId): PersonDependentCounts
    {
        $counts = new PersonDependentCounts();
        foreach ($this->members as $member) {
            $counts = $counts->plus($member->countOfPerson($personId));
        }

        return $counts;
    }

    public function recordPersonDeletion(Actor $actor, int $personId, int $cause): void
    {
        foreach ($this->members as $member) {
            $member->recordPersonDeletion($actor, $personId, $cause);
        }
    }
}
