<?php

declare(strict_types=1);

namespace Performance\Http;

use Performance\Domain\Account;
use Performance\Domain\Actor;
use Psr\Http\Message\ResponseFactoryInterface;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface;

/**
 * Lets only requests with a valid session through (401 otherwise), hands the
 * signed-in account to the route, and renews the cookie whenever the session was renewed
 * (at most once a day), so a session in use never expires. The renewal is committed before the
 * route runs, so a route that fails is answered here, with its problem, and the cookie too.
 */
final readonly class SessionAuth implements MiddlewareInterface
{
    public const ACCOUNT = 'account';
    public const TOKEN = 'sessionToken';

    public function __construct(
        private Database $database,
        private ResponseFactoryInterface $responses,
        private ProblemDetailsHandler $problems,
    ) {}

    public function process(ServerRequestInterface $request, RequestHandlerInterface $handler): ResponseInterface
    {
        $token = SessionCookie::read($request);
        $session = $token === null ? null : $this->database->sessions()->verify($token);
        if ($token === null || $session === null) {
            return Problem::unauthenticated()->write($this->responses->createResponse());
        }
        $request = $request->withAttribute(self::ACCOUNT, $session->account)->withAttribute(self::TOKEN, $token);
        try {
            $response = $handler->handle($request);
        } catch (\Throwable $failure) {
            $response = ($this->problems)($request, $failure);
        }

        // Only a renewal moves the expiry, in the database and in the browser alike.
        return $response->hasHeader('Set-Cookie') || !$session->renewed ? $response : SessionCookie::issue($response, $token);
    }

    public static function account(ServerRequestInterface $request): Account
    {
        $account = $request->getAttribute(self::ACCOUNT);
        if (!$account instanceof Account) {
            throw new \LogicException('The route is not behind SessionAuth');
        }

        return $account;
    }

    /** The signed-in account as the actor of a write, which the audit log records. */
    public static function actor(ServerRequestInterface $request): Actor
    {
        return Actor::of(self::account($request));
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
