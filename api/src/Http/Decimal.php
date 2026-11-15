<?php

declare(strict_types=1);

namespace Performance\Http;

/** Decimals leave the API as JSON numbers rounded to two places (`1.00` → `1`, `2.50` → `2.5`). */
final class Decimal
{
    public static function json(string|int|float $value): int|float
    {
        $rounded = round((float) $value, 2);

        return $rounded === floor($rounded) && abs($rounded) < PHP_INT_MAX ? (int) $rounded : $rounded;
    }
}
