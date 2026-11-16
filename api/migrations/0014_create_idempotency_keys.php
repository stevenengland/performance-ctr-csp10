<?php

declare(strict_types=1);

use Performance\Domain\Migration;

/*
 * The retry-key store that entries, matches and results share. It replaces `entry_requests`
 * by expanding, not renaming (ADR 0006): the previous release keeps writing and reading
 * `entry_requests` during a rollout, so that table stays, and Idempotency still finds the keys
 * in it. A later release, once this one has been live for the seven days keys are kept,
 * drops `entry_requests` together with that fallback.
 */
return new class implements Migration {
    public function isApplied(PDO $pdo): bool
    {
        $statement = $pdo->query(
            "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'idempotency_keys'",
        );

        return $statement !== false && (int) $statement->fetchColumn() > 0;
    }

    public function apply(PDO $pdo): void
    {
        $pdo->exec(
            'CREATE TABLE idempotency_keys (
                id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
                fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
                created_at DATETIME(3) NOT NULL,
                KEY idempotency_keys_created (created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
        );
    }
};
