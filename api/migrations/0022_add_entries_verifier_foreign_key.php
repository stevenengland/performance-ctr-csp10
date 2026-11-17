<?php

declare(strict_types=1);

use Performance\Domain\Migration;
use Performance\Domain\VerificationSchema;

/*
 * The verifying account of an entry, cleared when that account is deleted (PRD #61). INPLACE,
 * LOCK=NONE, with foreign key checks off on the migration's connection for this statement only:
 * every `verified_by_account_id` is still null, and the previous release never writes it. Then,
 * with checks on again, a verifier that names no account is set to null, and the step fails if
 * one remains (VerificationSchema).
 */
return new class implements Migration {
    public function isApplied(PDO $pdo): bool
    {
        return VerificationSchema::verifierForeignKeyHolds($pdo, 'entries');
    }

    public function apply(PDO $pdo): void
    {
        VerificationSchema::addVerifierForeignKey($pdo, 'entries');
    }
};
