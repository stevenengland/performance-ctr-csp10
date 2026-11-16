<?php

declare(strict_types=1);

use Performance\Domain\Migration;

/*
 * Person photos: at most one per person; a person without a photo has no row. A new table, so
 * the previous release never sees it (ADR 0006, expand only); its foreign key only deletes a
 * photo when the previous release deletes its person, which it does as before. Creating an
 * empty table copies nothing, so it needs no algorithm clause.
 */
return new class implements Migration {
    public function isApplied(PDO $pdo): bool
    {
        $statement = $pdo->query(
            "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'person_photos'",
        );

        return $statement !== false && (int) $statement->fetchColumn() > 0;
    }

    /**
     * `jpeg` is the photo as the API cleaned it, at most 64 KiB; `version` is the lowercase hex
     * SHA-256 of exactly those bytes. The photo goes with its person.
     */
    public function apply(PDO $pdo): void
    {
        $pdo->exec(
            "CREATE TABLE person_photos (
                person_id INT UNSIGNED NOT NULL PRIMARY KEY,
                jpeg MEDIUMBLOB NOT NULL,
                version CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
                updated_at DATETIME(3) NOT NULL,
                CONSTRAINT person_photos_jpeg CHECK (LENGTH(jpeg) <= 65536),
                CONSTRAINT person_photos_person FOREIGN KEY (person_id) REFERENCES persons (id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        );
    }
};
