<?php

declare(strict_types=1);

use Performance\Domain\Migration;

return new class implements Migration {
    public function isApplied(PDO $pdo): bool
    {
        $statement = $pdo->query(
            "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_events'",
        );

        return $statement !== false && (int) $statement->fetchColumn() > 0;
    }

    /**
     * The audit log: append-only history of catalog and entry changes. No foreign keys, so
     * deleting an account, a person, a drink or a factor never touches an event; snapshots are
     * JSON text encoded by the API, which keeps the table engine-neutral.
     */
    public function apply(PDO $pdo): void
    {
        $pdo->exec(
            "CREATE TABLE audit_events (
                id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
                occurred_at DATETIME(3) NOT NULL,
                operation VARCHAR(6) NOT NULL,
                subject_kind VARCHAR(6) NOT NULL,
                subject_id VARCHAR(36) NOT NULL,
                actor_account_id INT UNSIGNED NOT NULL,
                actor_user_name VARCHAR(40) NOT NULL,
                before_json TEXT NULL,
                after_json TEXT NULL,
                snapshot_version SMALLINT UNSIGNED NOT NULL,
                cause_id BIGINT UNSIGNED NULL,
                CONSTRAINT audit_events_operation CHECK (operation IN ('create', 'update', 'delete')),
                CONSTRAINT audit_events_subject_kind CHECK (subject_kind IN ('entry', 'person', 'drink', 'factor'))
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        );
    }
};
