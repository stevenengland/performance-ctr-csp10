<?php

declare(strict_types=1);

use Performance\Domain\Migration;

/*
 * Games: the scoreboards users create, each of a kind fixed in code. A new table, so the
 * previous release never sees it (ADR 0006, expand only).
 */
return new class implements Migration {
    public function isApplied(PDO $pdo): bool
    {
        $statement = $pdo->query(
            "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'games'",
        );

        return $statement !== false && (int) $statement->fetchColumn() > 0;
    }

    /**
     * The name is unique ignoring case (the collation decides), as for persons, drinks and
     * factors. `draws_allowed` is the duel setting, `lower_wins` the points setting; each kind
     * reads only its own. `run` counts the game's rankings: 1 on creation, one more on every
     * restart, which also sets `started_at`.
     */
    public function apply(PDO $pdo): void
    {
        $pdo->exec(
            "CREATE TABLE games (
                id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(40) NOT NULL,
                kind VARCHAR(6) NOT NULL,
                draws_allowed TINYINT(1) NOT NULL DEFAULT 1,
                lower_wins TINYINT(1) NOT NULL DEFAULT 0,
                run INT UNSIGNED NOT NULL DEFAULT 1,
                started_at DATETIME(3) NOT NULL,
                created_at DATETIME(3) NOT NULL,
                UNIQUE KEY games_name (name),
                CONSTRAINT games_kind CHECK (kind IN ('duel', 'points')),
                CONSTRAINT games_run CHECK (run >= 1)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        );
    }
};
