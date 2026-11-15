<?php

declare(strict_types=1);

namespace Performance\Domain;

use PDOException;

/**
 * MySQL's error codes that the domain answers instead of failing.
 */
final class DatabaseError
{
    public const DUPLICATE_KEY = 1062;
    public const MISSING_PARENT = 1452;
    public const DEADLOCK = 1213;

    public static function is(PDOException $failure, int ...$codes): bool
    {
        $code = $failure->errorInfo[1] ?? null;

        return is_int($code) && in_array($code, $codes, true);
    }
}
