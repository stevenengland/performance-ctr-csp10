<?php

declare(strict_types=1);

use Performance\Domain\Migration;

/*
 * Matches: the duels recorded in a duel game. A new table, so the previous release never sees
 * it (ADR 0006, expand only); its foreign keys only clear or delete matches when the previous
 * release deletes a person or an account, which it does as before.
 */
return new class implements Migration {
    public function isApplied(PDO $pdo): bool
    {
        $statement = $pdo->query(
            "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'matches'",
        );

        return $statement !== false && (int) $statement->fetchColumn() > 0;
    }

    /**
     * The id is the client's UUID, as for entries. A match goes with its game, keeps its row
     * when a person is deleted (that side becomes null, the other side's outcome still counts)
     * and when the recording account is deleted. `run` is the game's run when the match was
     * recorded; the game's ranking and Verlauf read one run, newest first, through
     * `matches_game`, which also serves the game's foreign key.
     */
    public function apply(PDO $pdo): void
    {
        $pdo->exec(
            "CREATE TABLE matches (
                id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
                game_id INT UNSIGNED NOT NULL,
                first_person_id INT UNSIGNED NULL,
                second_person_id INT UNSIGNED NULL,
                outcome VARCHAR(6) NOT NULL,
                run INT UNSIGNED NOT NULL,
                account_id INT UNSIGNED NULL,
                created_at DATETIME(3) NOT NULL,
                KEY matches_game (game_id, run, created_at, id),
                KEY matches_first (first_person_id),
                KEY matches_second (second_person_id),
                KEY matches_account (account_id),
                CONSTRAINT matches_outcome CHECK (outcome IN ('first', 'second', 'draw')),
                CONSTRAINT matches_run CHECK (run >= 1),
                CONSTRAINT matches_game FOREIGN KEY (game_id) REFERENCES games (id) ON DELETE CASCADE,
                CONSTRAINT matches_first FOREIGN KEY (first_person_id) REFERENCES persons (id) ON DELETE SET NULL,
                CONSTRAINT matches_second FOREIGN KEY (second_person_id) REFERENCES persons (id) ON DELETE SET NULL,
                CONSTRAINT matches_account FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE SET NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        );
    }
};
