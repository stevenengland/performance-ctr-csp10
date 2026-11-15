<?php

declare(strict_types=1);

use Performance\Domain\Migration;

return new class implements Migration {
    public function isApplied(PDO $pdo): bool
    {
        $statement = $pdo->query(
            "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sessions'",
        );

        return $statement !== false && (int) $statement->fetchColumn() > 0;
    }

    public function apply(PDO $pdo): void
    {
        $pdo->exec(
            'CREATE TABLE sessions (
                token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
                account_id INT UNSIGNED NOT NULL,
                created_at DATETIME(3) NOT NULL,
                last_seen_at DATETIME(3) NOT NULL,
                expires_at DATETIME(3) NOT NULL,
                KEY sessions_account (account_id),
                CONSTRAINT sessions_account FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
        );
    }
};
