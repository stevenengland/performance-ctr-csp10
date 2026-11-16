<?php

declare(strict_types=1);

namespace Performance\Domain;

use PDO;

/**
 * One forward-only schema change. MariaDB (like MySQL) commits DDL implicitly, so the guard
 * lets the migrator re-run a migration whose DDL ran before a crash.
 */
interface Migration
{
    /** Whether the change is already in the schema (checked through information_schema). */
    public function isApplied(PDO $pdo): bool;

    /** Applies the change: one DDL statement. */
    public function apply(PDO $pdo): void;
}
