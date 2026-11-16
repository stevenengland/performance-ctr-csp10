<?php

declare(strict_types=1);

namespace Performance\Domain;

/** The rows of other modules that name a person, by kind: so far the matches a deletion keeps. */
final readonly class PersonDependentCounts
{
    public function __construct(
        public int $matches = 0,
    ) {}

    public function plus(self $other): self
    {
        return new self($this->matches + $other->matches);
    }
}
