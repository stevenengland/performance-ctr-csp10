<?php

declare(strict_types=1);

namespace Performance\Http;

use Performance\Domain\Sessions;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;

/**
 * The session cookie: only the browser holds the token; scripts cannot read it
 * and it is never sent cross-site.
 */
final class SessionCookie
{
    public const NAME = 'session';

    public static function read(ServerRequestInterface $request): ?string
    {
        $token = $request->getCookieParams()[self::NAME] ?? null;

        return is_string($token) && $token !== '' ? $token : null;
    }

    /** Sets the cookie for the full session lifetime: at sign-in and whenever the session is renewed (sliding expiry). */
    public static function issue(ResponseInterface $response, string $token): ResponseInterface
    {
        return $response->withHeader('Set-Cookie', self::header($token, Sessions::lifetimeSeconds()));
    }

    public static function clear(ResponseInterface $response): ResponseInterface
    {
        return $response->withHeader('Set-Cookie', self::header('', 0));
    }

    private static function header(string $token, int $maxAge): string
    {
        return sprintf('%s=%s; Path=/; Max-Age=%d; HttpOnly; Secure; SameSite=Strict', self::NAME, $token, $maxAge);
    }
}
