<?php

declare(strict_types=1);

namespace Performance\Domain\Games;

use Closure;
use Performance\Domain\PendingMatch;
use Performance\Domain\PendingResult;
use Performance\Domain\VerifiableKind;

/**
 * How a game row owner's pending rows read for the pending queue (PRD #61): the kind they are
 * listed as, their columns and tables, and what one row is about.
 */
final readonly class PendingRead
{
    /**
     * @param string                                                      $from    what follows SELECT: the columns `id`, `created_at`, the
     *                                                                             recording account's `account_name` and the details, then
     *                                                                             FROM with the row table first under its alias; no WHERE
     * @param Closure(array<string, scalar|null>): (PendingMatch|PendingResult) $details what one row of `$from` is about
     */
    public function __construct(
        public VerifiableKind $kind,
        public string $from,
        public Closure $details,
    ) {}
}
