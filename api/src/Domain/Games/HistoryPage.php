<?php

declare(strict_types=1);

namespace Performance\Domain\Games;

/**
 * One page of a game's Verlauf, newest first, and where the next older page starts.
 *
 * @template T of MatchItem|ResultItem
 */
final readonly class HistoryPage
{
    /**
     * @param list<T>     $items newest first
     * @param string|null $next  the `before` of the next older page in the same run; null on the last page
     */
    public function __construct(
        public array $items,
        public ?string $next,
    ) {}
}
