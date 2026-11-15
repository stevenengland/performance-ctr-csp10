<?php

declare(strict_types=1);

namespace Performance\Http;

use Performance\Domain\Catalog\DuplicateName;
use Performance\Domain\DuplicateUserName;
use Performance\Domain\EntryConflict;
use Performance\Domain\NotFound;
use Performance\Domain\InvalidCredentials;
use Performance\Domain\LastAdmin;
use Performance\Domain\TooManyAttempts;
use Performance\Domain\ValidationFailed;
use Psr\Http\Message\ResponseFactoryInterface;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Slim\Exception\HttpMethodNotAllowedException;
use Slim\Exception\HttpNotFoundException;
use Throwable;

/**
 * Turns every exception into `application/problem+json`: routing and domain
 * exceptions into their problem types. Unexpected errors are
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
            $exception instanceof ValidationFailed => Problem::validation($exception->errors),
            $exception instanceof DuplicateUserName => Problem::duplicateUserName(),
            $exception instanceof DuplicateName => Problem::duplicateName(),
            $exception instanceof LastAdmin => Problem::lastAdmin(),
            $exception instanceof EntryConflict => Problem::entryConflict(),
            $exception instanceof NotFound => Problem::notFound(),
            $exception instanceof InvalidCredentials => Problem::invalidCredentials(),
            $exception instanceof TooManyAttempts => Problem::tooManyAttempts(),
            default => Problem::internal(),
        };
        if ($problem->status === 500) {
            error_log(sprintf('Unhandled %s: %s', $exception::class, $exception->getMessage()));
        }

        return $problem->write($this->responses->createResponse());
    }
}
