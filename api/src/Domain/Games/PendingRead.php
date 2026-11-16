<?php

declare(strict_types=1);

namespace Performance\Domain\Games;

use Closure;
use Performance\Domain\PendingMatch;
use Performance\Domain\PendingResult;
use Performance\Domain\VerifiableKind;

/**
 * How a game row owner's pending rows read for the pending queue (PRD #61): the kind they are
 * listed as, their SELECT and what one row is about.
 */
final readonly class PendingRead
{
    /**
     * @param string                                                      $select  the rows with their details, the table under its alias,
     *                                                                             naming `id`, `created_at` and the recording account's
     *                                                                             `account_name`; no WHERE
     * @param Closure(array<string, scalar|null>): (PendingMatch|PendingResult) $details what one row of `$select` is about
     */
    public function __construct(
        public VerifiableKind $kind,
        public string $select,
        public Closure $details,
    ) {}
}
