<?php

declare(strict_types=1);

namespace Performance\Http;

use Psr\Http\Message\ResponseFactoryInterface;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Slim\Exception\HttpMethodNotAllowedException;
use Slim\Exception\HttpNotFoundException;
use Throwable;

/**
 * Turns every exception into `application/problem+json`. Unexpected errors are
 * logged on the server and answered with a generic 500 that names nothing internal.
 */
final readonly class ProblemDetailsHandler
{
    public function __construct(private ResponseFactoryInterface $responses) {}

    public function __invoke(ServerRequestInterface $request, Throwable $exception): ResponseInterface
    {
        $problem = match (true) {
            $exception instanceof HttpNotFoundException => Problem::notFound(),
            $exception instanceof HttpMethodNotAllowedException => Problem::methodNotAllowed(),
            default => Problem::internal(),
        };
        if ($problem->status === 500) {
            error_log(sprintf('Unhandled %s: %s', $exception::class, $exception->getMessage()));
        }

        return $problem->write($this->responses->createResponse());
    }
}
