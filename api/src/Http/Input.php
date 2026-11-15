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
        $body = $request->getParsedBody();
        $value = is_array($body) ? ($body[$field] ?? null) : null;

        return is_string($value) ? $value : '';
    }
}
