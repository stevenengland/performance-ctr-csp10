<?php

declare(strict_types=1);

namespace Performance\Http;

use Performance\Domain\Account;
use Psr\Http\Message\ResponseFactoryInterface;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface;

/**
 * Lets only requests with a valid session through (401 otherwise), hands the
 * signed-in account to the route, and renews the cookie, so a session in use never expires.
 */
final readonly class SessionAuth implements MiddlewareInterface
{
    public const ACCOUNT = 'account';
    public const TOKEN = 'sessionToken';

    public function __construct(
        private Database $database,
        private ResponseFactoryInterface $responses,
    ) {}

    public function process(ServerRequestInterface $request, RequestHandlerInterface $handler): ResponseInterface
    {
        $token = SessionCookie::read($request);
        $account = $token === null ? null : $this->database->sessions()->verify($token);
        if ($token === null || $account === null) {
            return Problem::unauthenticated()->write($this->responses->createResponse());
        }
        $response = $handler->handle($request->withAttribute(self::ACCOUNT, $account)->withAttribute(self::TOKEN, $token));

        return $response->hasHeader('Set-Cookie') ? $response : SessionCookie::issue($response, $token);
    }

    public static function account(ServerRequestInterface $request): Account
    {
        $account = $request->getAttribute(self::ACCOUNT);
        if (!$account instanceof Account) {
            throw new \LogicException('The route is not behind SessionAuth');
        }

        return $account;
    }

    public static function token(ServerRequestInterface $request): string
    {
        $token = $request->getAttribute(self::TOKEN);
        if (!is_string($token)) {
            throw new \LogicException('The route is not behind SessionAuth');
        }

        return $token;
    }
}
