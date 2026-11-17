<?php

declare(strict_types=1);

namespace Performance\Domain;

/**
 * A person's standing in a day window. `score` and `count` cover the verified entries only;
 * `pendingCount` is the number of the person's entries in the window that wait for
 * verification. Decimals are exact strings, e.g. `7.50`.
 */
final readonly class ScoreRow
{
    /**
     * @param string|null $photoVersion the version of the person's photo, null without a photo
     * @param list<DrinkCount> $drinks by drink name
     */
    public function __construct(
        public int $personId,
        public string $name,
        public ?string $photoVersion,
        public string $score,
        public string $count,
        public int $pendingCount,
        public array $drinks,
    ) {}
}
