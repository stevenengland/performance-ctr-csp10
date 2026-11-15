<?php

declare(strict_types=1);

use Performance\Domain\Migration;

return new class implements Migration {
    public function isApplied(PDO $pdo): bool
    {
        $statement = $pdo->query(
            "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'accounts'",
        );

        return $statement !== false && (int) $statement->fetchColumn() > 0;
    }

    public function apply(PDO $pdo): void
    {
        $pdo->exec(
            'CREATE TABLE accounts (
                id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
                user_name VARCHAR(40) NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                is_admin TINYINT(1) NOT NULL DEFAULT 0,
                created_at DATETIME(3) NOT NULL,
                updated_at DATETIME(3) NOT NULL,
                UNIQUE KEY accounts_user_name (user_name)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
        );
    }
};
