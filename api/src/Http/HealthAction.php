<?php

declare(strict_types=1);

namespace Performance\Http;

use Performance\Domain\MigrationState;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;

final readonly class HealthAction
{
    public function __construct(
        private Database $database,
        private string $appVersion,
    ) {}

    public function __invoke(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        $state = $request->getAttribute(MigrationGate::ATTRIBUTE);

        return Json::write($response, [
            'appVersion' => $this->appVersion,
            'phpVersion' => PHP_VERSION,
            'database' => $this->databaseServer(),
            'schemaVersion' => $this->database->migrator()->schemaVersion(),
            'migration' => $state instanceof MigrationState ? $state->value : MigrationState::Failed->value,
            'minClientVersion' => Compatibility::MIN_CLIENT_VERSION,
        ]);
    }

    /**
     * @return array{engine: string, version: string}
     */
    private function databaseServer(): array
    {
        $statement = $this->database->pdo()->query('SELECT VERSION()');
        $version = $statement === false ? '' : $statement->fetchColumn();
        $version = is_string($version) ? $version : '';
        preg_match('/^\d+\.\d+\.\d+/', $version, $number);

        return [
            'engine' => stripos($version, 'mariadb') === false ? 'MySQL' : 'MariaDB',
            'version' => $number[0] ?? $version,
        ];
    }
}
