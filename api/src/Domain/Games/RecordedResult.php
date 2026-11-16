<?php

declare(strict_types=1);

namespace Performance\Domain\Games;

/** The answer to recording a result: the result, and whether this request recorded it or replayed an earlier one. */
final readonly class RecordedResult
{
    public function __construct(
        public Result $result,
        public bool $created,
    ) {}
}
