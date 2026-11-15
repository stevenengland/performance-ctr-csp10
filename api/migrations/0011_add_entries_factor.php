<?php

declare(strict_types=1);

use Performance\Domain\Migration;

return new class implements Migration {
    /** One ALTER, which InnoDB applies atomically: the column exists together with its key and foreign key, or not at all. */
    public function isApplied(PDO $pdo): bool
    {
        $statement = $pdo->query(
            "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'entries' AND COLUMN_NAME = 'factor_id'",
        );

        return $statement !== false && (int) $statement->fetchColumn() > 0;
    }

    /** A deleted factor leaves its entries, which then count ×1. */
    public function apply(PDO $pdo): void
    {
        $pdo->exec(
            'ALTER TABLE entries
                ADD COLUMN factor_id INT UNSIGNED NULL AFTER quantity,
                ADD KEY entries_factor (factor_id),
                ADD CONSTRAINT entries_factor FOREIGN KEY (factor_id) REFERENCES factors (id) ON DELETE SET NULL',
        );
    }
};
