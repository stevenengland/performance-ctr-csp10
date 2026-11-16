<?php

declare(strict_types=1);

use Performance\Domain\Migration;

/*
 * Numbered 0013, not 0012: PR #26 (audit log) adds 0012_create_audit_events. Migrations are
 * guarded and applied by name, so either pull request can merge and deploy first.
 */
return new class implements Migration {
    public function isApplied(PDO $pdo): bool
    {
        $statement = $pdo->query(
            "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'login_attempts' AND COLUMN_NAME = 'pending'",
        );

        return $statement !== false && (int) $statement->fetchColumn() > 0;
    }

    /**
     * Whether the attempt's password check is still running. Additive (expand only): the
     * default 0 is a finished failure, which is what a row of an older release always meant,
     * so that release keeps working on this schema, and MariaDB adds the column in place.
     */
    public function apply(PDO $pdo): void
    {
        $pdo->exec('ALTER TABLE login_attempts ADD COLUMN pending TINYINT(1) NOT NULL DEFAULT 0 AFTER attempted_at');
    }
};
