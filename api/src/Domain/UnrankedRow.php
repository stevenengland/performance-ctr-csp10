<?php

declare(strict_types=1);

namespace Performance\Domain;

/**
 * A person whose entries in a day window all wait for verification: listed without a rank,
 * score or total count, with the number of pending entries and the per-drink counters.
 */
final readonly class UnrankedRow
{
    /**
     * @param string|null $photoVersion the version of the person's photo, null without a photo
     * @param list<DrinkCount> $drinks by drink name; each `count` and `rawCount` is 0
     */
    public function __construct(
        public int $personId,
        public string $name,
        public ?string $photoVersion,
        public int $pendingCount,
        public array $drinks,
    ) {}
}
