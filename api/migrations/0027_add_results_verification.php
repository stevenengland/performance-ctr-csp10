<?php

declare(strict_types=1);

use Performance\Domain\Migration;
use Performance\Domain\VerificationSchema;

/*
 * The four-eyes rule (PRD #61): results gain `pending`, `verified_at` and
 * `verified_by_account_id`. Expand only (ADR 0006): `pending` defaults to 0, so every existing
 * result and every result the previous release still inserts counts, as it did. INSTANT.
 */
return new class implements Migration {
    public function isApplied(PDO $pdo): bool
    {
        return VerificationSchema::hasColumns($pdo, 'results');
    }

    public function apply(PDO $pdo): void
    {
        VerificationSchema::addColumns($pdo, 'results');
    }
};
