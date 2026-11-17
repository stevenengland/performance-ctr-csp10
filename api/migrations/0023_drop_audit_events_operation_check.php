<?php

declare(strict_types=1);

use Performance\Domain\Migration;

/*
 * The audit log records verifications (and later rejections) of pending rows (PRD #61), which
 * the check of `0012_create_audit_events` refuses. Like `0016` for the subject kind: widening a
 * check means adding a new one, which MariaDB documents no in-place algorithm for, so it is
 * dropped INSTANT, expand-only (every event the previous release writes is still valid). The
 * `AuditOperation` enum, the only writer's type, keeps the operations closed from now on;
 * `operation` stays VARCHAR(6), long enough for `verify` and `reject`.
 */
return new class implements Migration {
    public function isApplied(PDO $pdo): bool
    {
        $statement = $pdo->query(
            "SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
              WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_events' AND CONSTRAINT_NAME = 'audit_events_operation'",
        );

        return $statement !== false && (int) $statement->fetchColumn() === 0;
    }

    public function apply(PDO $pdo): void
    {
        $pdo->exec('ALTER TABLE audit_events DROP CONSTRAINT audit_events_operation, ALGORITHM=INSTANT');
    }
};
