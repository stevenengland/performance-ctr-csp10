<?php

declare(strict_types=1);

namespace Performance\Http;

use Psr\Http\Message\ServerRequestInterface;

/**
 * Optional query parameters of a GET request, read from the URI as the client sent it.
 */
final class Query
{
    /**
     * An optional whole-number parameter: null when it is missing; anything but an integer
     * reads as 0, which the domain then rejects.
     */
    public static function integer(ServerRequestInterface $request, string $name): ?int
    {
        $value = self::value($request, $name);
        if ($value === null) {
            return null;
        }

        return is_string($value) && preg_match('/^-?[0-9]{1,18}$/D', $value) === 1 ? (int) $value : 0;
    }

    /**
     * An optional text parameter: null when it is missing; a list (`name[]=…`) reads as the
     * empty text, which the domain then rejects.
     */
    public static function text(ServerRequestInterface $request, string $name): ?string
    {
        $value = self::value($request, $name);
        if ($value === null) {
            return null;
        }

        return is_string($value) ? $value : '';
    }

    private static function value(ServerRequestInterface $request, string $name): mixed
    {
        parse_str($request->getUri()->getQuery(), $query);

        return $query[$name] ?? null;
    }
}
