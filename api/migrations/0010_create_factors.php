<?php

declare(strict_types=1);

use Performance\Domain\Migration;

return new class implements Migration {
    public function isApplied(PDO $pdo): bool
    {
        $statement = $pdo->query(
            "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'factors'",
        );

        return $statement !== false && (int) $statement->fetchColumn() > 0;
    }

    public function apply(PDO $pdo): void
    {
        $pdo->exec(
            'CREATE TABLE factors (
                id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(40) NOT NULL,
                multiplier DECIMAL(4,2) NOT NULL,
                created_at DATETIME(3) NOT NULL,
                updated_at DATETIME(3) NOT NULL,
                UNIQUE KEY factors_name (name),
                CONSTRAINT factors_multiplier CHECK (multiplier > 0)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
        );
    }
};
