<?php

declare(strict_types=1);

use Performance\Domain\Migration;

/*
 * Results: one person's points in a points game. A new table, so the previous release never
 * sees it (ADR 0006, expand only); its foreign keys only delete results or clear their
 * recording account when the previous release deletes a person or an account, which it does
 * as before. Creating an empty table copies nothing, so it needs no algorithm clause.
 */
return new class implements Migration {
    public function isApplied(PDO $pdo): bool
    {
        $statement = $pdo->query(
            "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'results'",
        );

        return $statement !== false && (int) $statement->fetchColumn() > 0;
    }

    /**
     * The id is the client's UUID, as for entries and matches. A result goes with its game and
     * with its person, and keeps its row when the recording account is deleted. `points` is a
     * whole number from −9 999 to 9 999. `run` is the game's run when the result was recorded;
     * the game's ranking and Verlauf read one run, newest first, through `results_game`, which
     * also serves the game's foreign key.
     */
    public function apply(PDO $pdo): void
    {
        $pdo->exec(
            "CREATE TABLE results (
                id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
                game_id INT UNSIGNED NOT NULL,
                person_id INT UNSIGNED NOT NULL,
                points SMALLINT NOT NULL,
                run INT UNSIGNED NOT NULL,
                account_id INT UNSIGNED NULL,
                created_at DATETIME(3) NOT NULL,
                KEY results_game (game_id, run, created_at, id),
                KEY results_person (person_id),
                KEY results_account (account_id),
                CONSTRAINT results_points CHECK (points BETWEEN -9999 AND 9999),
                CONSTRAINT results_run CHECK (run >= 1),
                CONSTRAINT results_game FOREIGN KEY (game_id) REFERENCES games (id) ON DELETE CASCADE,
                CONSTRAINT results_person FOREIGN KEY (person_id) REFERENCES persons (id) ON DELETE CASCADE,
                CONSTRAINT results_account FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE SET NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        );
    }
};
