<?php

declare(strict_types=1);

namespace Performance\Http;

use Psr\Http\Message\ResponseFactoryInterface;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface;

/** Admin-only routes: 403 for every other signed-in account. Runs inside SessionAuth. */
final readonly class AdminOnly implements MiddlewareInterface
{
    public function __construct(private ResponseFactoryInterface $responses) {}

    public function process(ServerRequestInterface $request, RequestHandlerInterface $handler): ResponseInterface
    {
        if (!SessionAuth::account($request)->isAdmin) {
            return Problem::forbidden()->write($this->responses->createResponse());
        }

        return $handler->handle($request);
    }
}
