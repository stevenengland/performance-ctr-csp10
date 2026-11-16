<?php

declare(strict_types=1);

namespace Performance\Domain;

use PDOException;

/**
 * MariaDB's (and MySQL's) error codes that the domain answers instead of failing.
 */
final class DatabaseError
{
    public const DUPLICATE_KEY = 1062;
    public const MISSING_PARENT = 1452;
    public const DEADLOCK = 1213;
    /**
     * MariaDB's answer when InnoDB's table-level AUTO-INC lock, which an `INSERT … SELECT`
     * takes under its default `innodb_autoinc_lock_mode = 1`, ends in a deadlock: the
     * statement is rolled back as for DEADLOCK, but reported as "Failed to read
     * auto-increment value from storage engine". MySQL 8 (lock mode 2) never takes that lock.
     */
    public const AUTO_INCREMENT_LOCK = 1467;

    public static function is(PDOException $failure, int ...$codes): bool
    {
        $code = $failure->errorInfo[1] ?? null;

        return is_int($code) && in_array($code, $codes, true);
    }
}
