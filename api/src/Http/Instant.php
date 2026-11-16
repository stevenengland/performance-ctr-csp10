<?php

declare(strict_types=1);

namespace Performance\Http;

use DateTimeImmutable;
use DateTimeZone;
use Performance\Domain\ValidationFailed;

/** ISO-8601 instants at the API edge: UTC with milliseconds out, any offset in. */
final class Instant
{
    public static function format(DateTimeImmutable $instant): string
    {
        return $instant->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:s.v\Z');
    }

    /**
     * @throws ValidationFailed unless the value is a date, time and offset (`2026-11-14T23:00:00.000Z`)
     */
    public static function parse(string $field, string $value): DateTimeImmutable
    {
        // The date parser throws on a null byte instead of failing.
        if (str_contains($value, "\0")) {
            throw self::invalid($field);
        }
        foreach (['Y-m-d\TH:i:s.vP', 'Y-m-d\TH:i:sP'] as $format) {
            $instant = DateTimeImmutable::createFromFormat("!{$format}", $value);
            if ($instant !== false && DateTimeImmutable::getLastErrors() === false) {
                return $instant;
            }
        }
        throw self::invalid($field);
    }

    private static function invalid(string $field): ValidationFailed
    {
        return new ValidationFailed([$field => 'Zeitpunkt nach ISO 8601 mit Zeitzone.']);
    }
}
