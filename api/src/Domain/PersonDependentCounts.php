<?php

declare(strict_types=1);

namespace Performance\Domain;

/** The rows of other modules that name a person, by kind: the matches a deletion keeps and the results it deletes. */
final readonly class PersonDependentCounts
{
    public function __construct(
        public int $matches = 0,
        public int $results = 0,
    ) {}

    public function plus(self $other): self
    {
        return new self($this->matches + $other->matches, $this->results + $other->results);
    }
}
