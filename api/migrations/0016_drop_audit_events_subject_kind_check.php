<?php

declare(strict_types=1);

use Performance\Domain\Migration;

/*
 * The audit log records games (and later matches and results), which the check of
 * `0012_create_audit_events` refuses. Widening a check means adding a new one, and MariaDB
 * documents no in-place algorithm for that: it would copy the whole log under the migration
 * lock (ADR 0006, rule 2). Dropping it is INSTANT and expand-only: every event the previous
 * release writes is still valid. The `AuditSubjectKind` enum, the only writer's type, keeps
 * the kinds closed from now on; `subject_kind` stays VARCHAR(6), long enough for `result`.
 */
return new class implements Migration {
    public function isApplied(PDO $pdo): bool
    {
        $statement = $pdo->query(
            "SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
              WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_events' AND CONSTRAINT_NAME = 'audit_events_subject_kind'",
        );

        return $statement !== false && (int) $statement->fetchColumn() === 0;
    }

    public function apply(PDO $pdo): void
    {
        $pdo->exec('ALTER TABLE audit_events DROP CONSTRAINT audit_events_subject_kind, ALGORITHM=INSTANT');
    }
};
