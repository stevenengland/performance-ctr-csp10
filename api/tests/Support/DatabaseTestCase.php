<?php

declare(strict_types=1);

namespace Performance\Tests\Support;

use PDO;
use Performance\Domain\BootstrapAdmin;
use Performance\Http\App;
use Performance\Http\Config;
use PHPUnit\Framework\TestCase;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Server\RequestHandlerInterface;
use Slim\Psr7\Factory\ServerRequestFactory;

/**
 * Drives the application's request handler in memory against a fresh, empty
 * database on the MariaDB server named by the DB_* environment variables.
 */
abstract class DatabaseTestCase extends TestCase
{
    protected const APP_VERSION = '0.1.0+test';
    protected const ADMIN = 'chef';
    protected const ADMIN_PASSWORD = 'bootstrap-passwort';

    protected TestClock $clock;

    /** @var array<string, string> password hashes by password, as hashing is slow on purpose */
    private static array $hashes = [];

    protected function setUp(): void
    {
        $this->clock = new TestClock();
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
        return $this->configWith(self::bootstrapAdmin(), ...$extraMigrationDirectories);
    }

    protected function configWith(?BootstrapAdmin $bootstrapAdmin, string ...$extraMigrationDirectories): Config
    {
        $extraMigrationDirectories = array_values($extraMigrationDirectories);

        return new Config(
            databaseDsn: self::dsn(self::env('DB_NAME'), self::env('DB_PORT')),
            databaseUser: self::env('DB_USER'),
            databasePassword: self::env('DB_PASS'),
            appVersion: self::APP_VERSION,
            migrationDirectories: [dirname(__DIR__, 2) . '/migrations', ...$extraMigrationDirectories],
            bootstrapAdmin: $bootstrapAdmin,
        );
    }

    /** The bootstrap admin every test installation is configured with, unless a test says otherwise. */
    protected static function bootstrapAdmin(string $userName = self::ADMIN, string $password = self::ADMIN_PASSWORD): BootstrapAdmin
    {
        return new BootstrapAdmin($userName, self::$hashes[$password] ??= password_hash($password, PASSWORD_DEFAULT));
    }

    /**
     * The names of the API's own migrations, in order.
     *
     * @return list<string>
     */
    protected static function migrationNames(): array
    {
        $names = array_map(
            static fn(string $file): string => basename($file, '.php'),
            glob(dirname(__DIR__, 2) . '/migrations/[0-9][0-9][0-9][0-9]_*.php') ?: [],
        );
        sort($names, SORT_STRING);

        return $names;
    }

    /** The schema version of an installation with every one of the API's own migrations. */
    protected static function schemaVersion(): int
    {
        $names = self::migrationNames();

        return (int) substr((string) end($names), 0, 4);
    }

    protected function fixtureMigrations(string $name): string
    {
        return __DIR__ . '/Migrations/' . $name;
    }

    protected function app(?Config $config = null): RequestHandlerInterface
    {
        return App::create($config ?? $this->config(), clock: $this->clock);
    }

    protected function get(string $path, ?RequestHandlerInterface $app = null): ResponseInterface
    {
        $request = (new ServerRequestFactory())->createServerRequest('GET', $path);

        return ($app ?? $this->app())->handle($request);
    }

    /**
     * One request through the application's request handler, as a browser would send it.
     *
     * @param array<string, mixed>|null $json sent as `application/json`
     */
    protected function send(
        string $method,
        string $path,
        ?array $json = null,
        ?string $session = null,
        ?RequestHandlerInterface $app = null,
        string $clientAddress = '192.0.2.10',
    ): ResponseInterface {
        $request = (new ServerRequestFactory())->createServerRequest($method, $path, ['REMOTE_ADDR' => $clientAddress]);
        if ($json !== null) {
            $request->getBody()->write(json_encode($json, JSON_THROW_ON_ERROR));
            $request = $request->withHeader('Content-Type', 'application/json');
        }
        if ($session !== null) {
            $request = $request->withCookieParams(['session' => $session])->withHeader('Cookie', "session={$session}");
        }

        return ($app ?? $this->app())->handle($request);
    }

    /**
     * Signs in and returns the session token from the cookie.
     */
    protected function signIn(string $userName = self::ADMIN, string $password = self::ADMIN_PASSWORD, ?RequestHandlerInterface $app = null): string
    {
        $response = $this->send('POST', '/api/session', ['userName' => $userName, 'password' => $password], app: $app);
        self::assertSame(200, $response->getStatusCode(), (string) $response->getBody());

        return $this->sessionToken($response);
    }

    protected function sessionToken(ResponseInterface $response): string
    {
        $matched = preg_match('/^session=([^;]*)/', $response->getHeaderLine('Set-Cookie'), $cookie);
        self::assertSame(1, $matched, 'the response sets the session cookie');

        return $cookie[1];
    }

    /** Creates an account through the API as the bootstrap admin. */
    protected function createAccount(string $userName, string $password, ?RequestHandlerInterface $app = null): void
    {
        $response = $this->send('POST', '/api/accounts', ['userName' => $userName, 'password' => $password], $this->signIn(app: $app), $app);
        self::assertSame(201, $response->getStatusCode(), (string) $response->getBody());
    }

    /**
     * Lets a recorded entry, match or result count, as another account's verification does
     * (PRD #61). Set directly, by another session, until the API can verify.
     *
     * @param 'entries'|'matches'|'results' $table
     */
    protected function verifyDirectly(string $table, string $id): void
    {
        $this->otherSession()->prepare("UPDATE {$table} SET pending = 0 WHERE id = ?")->execute([$id]);
    }

    /**
     * @return list<array<string, mixed>>
     */
    protected function rows(string $sql): array
    {
        $statement = $this->otherSession()->query($sql);
        self::assertNotFalse($statement);

        /** @var list<array<string, mixed>> */
        return $statement->fetchAll(PDO::FETCH_ASSOC);
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
