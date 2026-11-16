<?php

declare(strict_types=1);

namespace Performance\Http;

use Performance\Domain\AlreadyVerified;
use Performance\Domain\Catalog\DuplicateName;
use Performance\Domain\DuplicateUserName;
use Performance\Domain\EntryConflict;
use Performance\Domain\InvalidCredentials;
use Performance\Domain\NotFound;
use Performance\Domain\OwnRow;
use Performance\Domain\LastAdmin;
use Performance\Domain\RequestConflict;
use Performance\Domain\Sessions;
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
            $exception instanceof RequestConflict => Problem::requestConflict(),
            $exception instanceof NotFound => Problem::notFound(),
            $exception instanceof OwnRow => Problem::ownRow(),
            $exception instanceof AlreadyVerified => Problem::alreadyVerified(),
            $exception instanceof InvalidCredentials => Problem::invalidCredentials(),
            $exception instanceof TooManyAttempts => Problem::tooManyAttempts(),
            default => Problem::internal(),
        };
        if ($problem->status === 500) {
            error_log(sprintf('Unhandled %s: %s', $exception::class, $exception->getMessage()));
        }

        $response = $problem->write($this->responses->createResponse());

        return match (true) {
            $exception instanceof HttpMethodNotAllowedException => $response->withHeader('Allow', implode(', ', $exception->getAllowedMethods())),
            // The longest a client has to wait: until the window of the oldest failure has passed.
            $exception instanceof TooManyAttempts => $response->withHeader('Retry-After', (string) (Sessions::FAILURE_WINDOW_MINUTES * 60)),
            default => $response,
        };
    }
}
