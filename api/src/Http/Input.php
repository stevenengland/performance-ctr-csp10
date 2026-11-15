<?php

declare(strict_types=1);

namespace Performance\Http;

use Psr\Http\Message\ServerRequestInterface;

/** Reads fields of the JSON body that JsonBody parsed. */
final class Input
{
    /** The field's text; a missing or non-text field reads as empty, which the domain rules then reject. */
    public static function text(ServerRequestInterface $request, string $field): string
    {
        $value = self::value($request, $field);

        return is_string($value) ? $value : '';
    }

    /** The field's JSON number; anything else reads as null, which the domain rules then reject. */
    public static function number(ServerRequestInterface $request, string $field): int|float|null
    {
        $value = self::value($request, $field);

        return is_int($value) || is_float($value) ? $value : null;
    }

    /** The field's JSON integer; anything else reads as null, which the domain rules then reject. */
    public static function integer(ServerRequestInterface $request, string $field): ?int
    {
        $value = self::value($request, $field);

        return is_int($value) ? $value : null;
    }

    /**
     * An optional reference: null when the field is missing or null; anything but an
     * integer reads as 0, an id no row has, which the domain then reports as not found.
     */
    public static function optionalId(ServerRequestInterface $request, string $field): ?int
    {
        $value = self::value($request, $field);

        return $value === null ? null : (is_int($value) ? $value : 0);
    }

    private static function value(ServerRequestInterface $request, string $field): mixed
    {
        $body = $request->getParsedBody();

        return is_array($body) ? ($body[$field] ?? null) : null;
    }
}
