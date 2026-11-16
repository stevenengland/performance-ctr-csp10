<?php

declare(strict_types=1);

namespace Performance\Domain;

/** All of a game's dependents as one: the counts add up, and each member records its rows' removal in turn. */
final readonly class CompositeGameDependents implements GameDependents
{
    /** @var list<GameDependents> */
    private array $members;

    public function __construct(GameDependents ...$members)
    {
        $this->members = array_values($members);
    }

    public function count(int $gameId): int
    {
        $rows = 0;
        foreach ($this->members as $member) {
            $rows += $member->count($gameId);
        }

        return $rows;
    }

    public function recordRemoval(Actor $actor, int $gameId, int $cause): void
    {
        foreach ($this->members as $member) {
            $member->recordRemoval($actor, $gameId, $cause);
        }
    }
}
