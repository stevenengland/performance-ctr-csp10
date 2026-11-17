<?php

declare(strict_types=1);

namespace Performance\Domain\Games;

use DateTimeImmutable;
use DateTimeZone;
use Performance\Domain\Interval;

/**
 * A game as created in the app. Each kind has one setting: a duel game whether draws count
 * (`drawsAllowed`), a points game whether the lowest sum wins (`lowerWins`); the other one
 * keeps its default and means nothing. `run` counts the game's rankings, and `startedAt` is
 * when the current one began.
 */
final readonly class Game
{
    public function __construct(
        public int $id,
        public string $name,
        public GameKind $kind,
        public bool $drawsAllowed,
        public bool $lowerWins,
        public int $run,
        public DateTimeImmutable $startedAt,
    ) {}

    /**
     * The game's values as the audit log keeps them: its name, kind, its kind's setting, its
     * run and when the run started (ISO 8601, UTC).
     *
     * @return array<string, string|bool|int>
     */
    public function snapshot(): array
    {
        $setting = match ($this->kind) {
            GameKind::Duel => ['drawsAllowed' => $this->drawsAllowed],
            GameKind::Points => ['lowerWins' => $this->lowerWins],
        };

        return [
            'name' => $this->name,
            'kind' => $this->kind->value,
            ...$setting,
            'run' => $this->run,
            'startedAt' => $this->startedAt->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:s.v\Z'),
        ];
    }

    /**
     * The SQL condition, without `WHERE`, that a match or result of this game lies in the
     * selection, with its parameters in order: the current run by its number, an interval by
     * the row's recording instant alone, whatever its run. `$prefix` qualifies the columns
     * (`game_id`, `run`, `created_at`), e.g. `r.`.
     *
     * @return array{string, list<int|string>}
     */
    public function rowsIn(Interval|CurrentRun $selection, string $prefix = ''): array
    {
        return $selection instanceof Interval
            ? ["{$prefix}game_id = ? AND " . $selection->condition("{$prefix}created_at"), [$this->id, ...$selection->parameters()]]
            : ["{$prefix}game_id = ? AND {$prefix}run = ?", [$this->id, $this->run]];
    }
}
