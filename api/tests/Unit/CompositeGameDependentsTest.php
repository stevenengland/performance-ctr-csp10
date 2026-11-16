<?php

declare(strict_types=1);

namespace Performance\Tests\Unit;

use ArrayObject;
use Performance\Domain\Actor;
use Performance\Domain\CompositeGameDependents;
use Performance\Domain\GameDependents;
use PHPUnit\Framework\TestCase;

final class CompositeGameDependentsTest extends TestCase
{
    public function testWithoutMembersAGameHasNoDependentRowsAndNothingToRecord(): void
    {
        $none = new CompositeGameDependents();

        self::assertSame(0, $none->count(1));
        $none->recordRemoval(new Actor(1, 'chef'), 1, 7);
        $this->addToAssertionCount(1);
    }

    public function testCountsTheRowsOfEveryMemberAndAsksEachInTurnToRecordItsRemoval(): void
    {
        $log = new ArrayObject();
        $matches = self::member('matches', 3, $log);
        $results = self::member('results', 4, $log);

        $all = new CompositeGameDependents($matches, $results);
        $all->recordRemoval(new Actor(2, 'daniel'), 5, 9);

        self::assertSame(7, $all->count(5));
        self::assertSame(['matches daniel 5 9', 'results daniel 5 9'], $log->getArrayCopy());
    }

    /**
     * @param ArrayObject<int, string> $log
     */
    private static function member(string $name, int $rows, ArrayObject $log): GameDependents
    {
        return new class ($name, $rows, $log) implements GameDependents {
            /**
             * @param ArrayObject<int, string> $log
             */
            public function __construct(private string $name, private int $rows, private ArrayObject $log) {}

            public function count(int $gameId): int
            {
                return $this->rows;
            }

            public function recordRemoval(Actor $actor, int $gameId, int $cause): void
            {
                $this->log[] = "{$this->name} {$actor->userName} {$gameId} {$cause}";
            }
        };
    }
}
