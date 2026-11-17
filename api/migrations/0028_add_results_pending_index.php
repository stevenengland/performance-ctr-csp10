<?php

declare(strict_types=1);

use Performance\Domain\Migration;
use Performance\Domain\VerificationSchema;

/* The index of the pending-queue read of results (PRD #61). INPLACE, LOCK=NONE. */
return new class implements Migration {
    public function isApplied(PDO $pdo): bool
    {
        return VerificationSchema::hasPendingIndex($pdo, 'results');
    }

    public function apply(PDO $pdo): void
    {
        VerificationSchema::addPendingIndex($pdo, 'results');
    }
};
