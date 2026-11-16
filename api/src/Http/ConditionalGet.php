<?php

declare(strict_types=1);

namespace Performance\Http;

use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;

/**
 * Conditional GET for the polled rankings: the response carries the ETag, and a request whose
 * `If-None-Match` names it answers 304 without the body ever being built.
 */
final class ConditionalGet
{
    /**
     * @param callable(ResponseInterface): ResponseInterface $body writes the body of a 200; not called for a 304
     */
    public static function respond(ServerRequestInterface $request, ResponseInterface $response, string $tag, callable $body): ResponseInterface
    {
        $response = $response->withHeader('ETag', $tag);

        return self::matches($request->getHeaderLine('If-None-Match'), $tag) ? $response->withStatus(304) : $body($response);
    }

    /**
     * Whether `If-None-Match` names the tag: `*`, or one of a list of (weak) tags, also
     * with the `-gzip`/`-br` suffix Apache adds to tags of the responses it compresses.
     */
    private static function matches(string $ifNoneMatch, string $tag): bool
    {
        foreach (explode(',', $ifNoneMatch) as $candidate) {
            $candidate = preg_replace(['/^W\//', '/-(gzip|br)"$/'], ['', '"'], trim($candidate));
            if ($candidate === '*' || $candidate === $tag) {
                return true;
            }
        }

        return false;
    }
}
