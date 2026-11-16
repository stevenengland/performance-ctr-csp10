<?php

declare(strict_types=1);

namespace Performance\Domain;

/** The outcome of an add: the entry, and whether this request created it or replayed an earlier one. */
final readonly class AddedEntry
{
    public function __construct(
        public Entry $entry,
        public bool $created,
    ) {}
}
