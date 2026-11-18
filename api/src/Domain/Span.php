<?php

declare(strict_types=1);

namespace Performance\Domain;

use DateTimeImmutable;

/** A half-open stretch of time `[from, to)`: a run of consecutive quarter hours with rows that count. */
final readonly class Span
{
    public function __construct(
        public DateTimeImmutable $from,
        public DateTimeImmutable $to,
    ) {}
}
