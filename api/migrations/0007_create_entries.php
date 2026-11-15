<?php

declare(strict_types=1);

use Performance\Domain\Migration;

return new class implements Migration {
    public function isApplied(PDO $pdo): bool
    {
        $statement = $pdo->query(
            "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'entries'",
        );

        return $statement !== false && (int) $statement->fetchColumn() > 0;
    }

    public function apply(PDO $pdo): void
    {
        $pdo->exec(
            'CREATE TABLE entries (
                id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
                person_id INT UNSIGNED NOT NULL,
                drink_id INT UNSIGNED NOT NULL,
                quantity TINYINT UNSIGNED NOT NULL,
                account_id INT UNSIGNED NULL,
                created_at DATETIME(3) NOT NULL,
                KEY entries_created (created_at),
                KEY entries_person (person_id, created_at),
                KEY entries_drink (drink_id),
                KEY entries_account (account_id),
                CONSTRAINT entries_quantity CHECK (quantity BETWEEN 1 AND 99),
                CONSTRAINT entries_person FOREIGN KEY (person_id) REFERENCES persons (id) ON DELETE CASCADE,
                CONSTRAINT entries_drink FOREIGN KEY (drink_id) REFERENCES drinks (id) ON DELETE CASCADE,
                CONSTRAINT entries_account FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE SET NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
        );
    }
};
