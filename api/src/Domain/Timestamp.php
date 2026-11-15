<?php

declare(strict_types=1);

namespace Performance\Domain;

use DateTimeImmutable;
use DateTimeZone;

/**
 * The database's `DATETIME(3)` form of a UTC instant.
 */
final class Timestamp
{
    public static function of(DateTimeImmutable $instant): string
    {
        return $instant->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s.v');
    }
}
