<?php

declare(strict_types=1);

namespace Performance\Tests\Support;

use PDO;
use Performance\Http\App;
use Performance\Http\Config;
use PHPUnit\Framework\TestCase;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Server\RequestHandlerInterface;
use Slim\Psr7\Factory\ServerRequestFactory;

/**
 * Drives the application's request handler in memory against a fresh, empty
 * database on the MySQL server named by the DB_* environment variables.
 */
abstract class DatabaseTestCase extends TestCase
{
    protected const APP_VERSION = '0.1.0+test';

    protected function setUp(): void
    {
        $server = $this->connect('');
        $name = self::env('DB_NAME');
        $server->exec("DROP DATABASE IF EXISTS `{$name}`");
        $server->exec("CREATE DATABASE `{$name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
    }

    /**
     * A second, independent session on the test database, as another request would have.
     */
    protected function otherSession(): PDO
    {
        return $this->connect(self::env('DB_NAME'));
    }

    protected function config(string ...$extraMigrationDirectories): Config
    {
        $extraMigrationDirectories = array_values($extraMigrationDirectories);

        return new Config(
            databaseDsn: self::dsn(self::env('DB_NAME'), self::env('DB_PORT')),
            databaseUser: self::env('DB_USER'),
            databasePassword: self::env('DB_PASS'),
            appVersion: self::APP_VERSION,
            migrationDirectories: [dirname(__DIR__, 2) . '/migrations', ...$extraMigrationDirectories],
        );
    }

    protected function fixtureMigrations(string $name): string
    {
        return __DIR__ . '/Migrations/' . $name;
    }

    protected function app(?Config $config = null): RequestHandlerInterface
    {
        return App::create($config ?? $this->config());
    }

    protected function get(string $path, ?RequestHandlerInterface $app = null): ResponseInterface
    {
        $request = (new ServerRequestFactory())->createServerRequest('GET', $path);

        return ($app ?? $this->app())->handle($request);
    }

    /**
     * @return array<string, mixed>
     */
    protected function body(ResponseInterface $response): array
    {
        $decoded = json_decode((string) $response->getBody(), true, flags: JSON_THROW_ON_ERROR);
        self::assertIsArray($decoded);

        /** @var array<string, mixed> $decoded */
        return $decoded;
    }

    protected static function dsn(string $database, string $port): string
    {
        $dsn = sprintf('mysql:host=%s;port=%s;charset=utf8mb4', self::env('DB_HOST'), $port);

        return $database === '' ? $dsn : "{$dsn};dbname={$database}";
    }

    protected static function env(string $name): string
    {
        $value = getenv($name);
        if (!is_string($value) || $value === '') {
            self::fail("Environment variable {$name} is not set");
        }

        return $value;
    }

    private function connect(string $database): PDO
    {
        return new PDO(
            self::dsn($database, self::env('DB_PORT')),
            self::env('DB_USER'),
            self::env('DB_PASS'),
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION],
        );
    }
}
