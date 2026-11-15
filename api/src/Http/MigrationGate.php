<?php

declare(strict_types=1);

namespace Performance\Http;

use Performance\Domain\MigrationState;
use Psr\Http\Message\ResponseFactoryInterface;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface;

/**
 * Every request brings the schema up to date first. While another request
 * migrates, or after a migration failed, only health answers; the rest get 503.
 */
final readonly class MigrationGate implements MiddlewareInterface
{
    public const ATTRIBUTE = 'migrationState';
    public const RETRY_AFTER_SECONDS = 5;

    public function __construct(
        private Database $database,
        private ResponseFactoryInterface $responses,
        private string $healthPath,
    ) {}

    public function process(ServerRequestInterface $request, RequestHandlerInterface $handler): ResponseInterface
    {
        $state = $this->database->migrator()->migrate();
        if ($state === MigrationState::Ok || $request->getUri()->getPath() === $this->healthPath) {
            return $handler->handle($request->withAttribute(self::ATTRIBUTE, $state));
        }
        $response = $this->responses->createResponse();
        if ($state === MigrationState::Running) {
            return Problem::maintenance()->write($response)
                ->withHeader('Retry-After', (string) self::RETRY_AFTER_SECONDS);
        }

        return Problem::migrationFailed()->write($response);
    }
}
