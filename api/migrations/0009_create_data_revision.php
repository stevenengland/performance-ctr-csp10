<?php

declare(strict_types=1);

use Performance\Domain\Migration;

return new class implements Migration {
    public function isApplied(PDO $pdo): bool
    {
        $statement = $pdo->query(
            "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'data_revision'",
        );

        return $statement !== false && (int) $statement->fetchColumn() > 0;
    }

    /**
     * One row (id 1), created by the first write; until then the revision is 0.
     */
    public function apply(PDO $pdo): void
    {
        $pdo->exec(
            'CREATE TABLE data_revision (
                id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
                revision BIGINT UNSIGNED NOT NULL,
                CONSTRAINT data_revision_single_row CHECK (id = 1)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
        );
    }
};
