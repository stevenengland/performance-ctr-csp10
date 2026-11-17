<?php

declare(strict_types=1);

namespace Performance\Domain;

use DateTimeImmutable;

/**
 * What a ranking or a list covers, as the action normalised it from the query: the rows
 * recorded in the half-open window `[from, to)`, from `from` on when there is no end, or every
 * row (all time: no lower and no upper bound). A row belongs to it by its recording instant
 * (`created_at`) alone; its verification never moves it.
 *
 * The reads take this value instead of raw optional parameters, and an end that is not after
 * the start cannot be made, so every read filters and rejects windows alike.
 */
final readonly class Interval
{
    private function __construct(
        public ?DateTimeImmutable $from,
        public ?DateTimeImmutable $to,
    ) {}

    /**
     * @throws ValidationFailed naming `to` unless the end is after the start
     */
    public static function window(DateTimeImmutable $from, ?DateTimeImmutable $to = null): self
    {
        if ($to !== null && $to <= $from) {
            throw new ValidationFailed(['to' => 'Zeitpunkt nach from.']);
        }

        return new self($from, $to);
    }

    public static function allTime(): self
    {
        return new self(null, null);
    }

    public function isAllTime(): bool
    {
        return $this->from === null;
    }

    /**
     * The SQL condition that a row's recording instant in `$column` lies in the interval,
     * without `WHERE`; its placeholders take `parameters()`, in order.
     */
    public function condition(string $column): string
    {
        return match (true) {
            $this->from === null => 'TRUE',
            $this->to === null => "{$column} >= ?",
            default => "{$column} >= ? AND {$column} < ?",
        };
    }

    /**
     * The parameters of `condition()`, in order.
     *
     * @return list<string>
     */
    public function parameters(): array
    {
        return array_map(Timestamp::of(...), array_values(array_filter([$this->from, $this->to])));
    }
}
