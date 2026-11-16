<?php

declare(strict_types=1);

namespace Performance\Tests\Integration;

use Performance\Http\Config;
use Performance\Tests\Support\DatabaseTestCase;
use Slim\Psr7\Factory\ServerRequestFactory;

final class HealthTest extends DatabaseTestCase
{
    public function testReportsVersionsSchemaAndMigrationStateOfAnUpToDateInstallation(): void
    {
        $response = $this->get('/api/health');

        self::assertSame(200, $response->getStatusCode());
        self::assertSame('application/json', $response->getHeaderLine('Content-Type'));
        $health = $this->body($response);
        self::assertSame(self::APP_VERSION, $health['appVersion']);
        self::assertSame(PHP_VERSION, $health['phpVersion']);
        self::assertSame(['engine', 'version'], array_keys((array) $health['database']));
        $database = (array) $health['database'];
        self::assertContains($database['engine'], ['MySQL', 'MariaDB']);
        self::assertIsString($database['version']);
        self::assertMatchesRegularExpression('/^\d+\.\d+\.\d+$/', $database['version']);
        self::assertSame(self::schemaVersion(), $health['schemaVersion']);
        self::assertSame('ok', $health['migration']);
        self::assertSame('0.1.0', $health['minClientVersion']);
    }

    /**
     * A newer release migrated the database (here: 9001), then an older release's PHP
     * answers again. Its health must report the schema the database is really at, not
     * the newest of its own migration files, so the deploy sees the mismatch.
     */
    public function testAnOlderReleaseReportsTheNewerSchemaTheDatabaseIsAt(): void
    {
        $newer = $this->body($this->get('/api/health', $this->app($this->config($this->fixtureMigrations('crash')))));
        self::assertSame(9001, $newer['schemaVersion']);

        $older = $this->body($this->get('/api/health'));

        self::assertSame(9001, $older['schemaVersion']);
        self::assertSame('ok', $older['migration']);
    }

    public function testAnswersUnknownApiRoutesWithA404Problem(): void
    {
        $response = $this->get('/api/does-not-exist');

        self::assertSame(404, $response->getStatusCode());
        self::assertSame('application/problem+json', $response->getHeaderLine('Content-Type'));
        self::assertSame(
            ['type' => 'urn:performance:problem:not-found', 'title' => 'Nicht gefunden', 'status' => 404],
            $this->body($response),
        );
    }

    public function testAnswersAnUnsupportedMethodWithA405Problem(): void
    {
        $request = (new ServerRequestFactory())->createServerRequest('POST', '/api/health');

        $response = $this->app()->handle($request);

        self::assertSame(405, $response->getStatusCode());
        self::assertSame('GET', $response->getHeaderLine('Allow'));
        self::assertSame('application/problem+json', $response->getHeaderLine('Content-Type'));
        self::assertSame('urn:performance:problem:method-not-allowed', $this->body($response)['type']);
    }

    public function testAnswersUnexpectedErrorsWithA500ProblemThatRevealsNothingInternal(): void
    {
        $reachable = $this->config();
        $unreachable = new Config(
            databaseDsn: self::dsn(self::env('DB_NAME'), '1'),
            databaseUser: $reachable->databaseUser,
            databasePassword: 'wrong-password-for-test',
            appVersion: $reachable->appVersion,
            migrationDirectories: $reachable->migrationDirectories,
        );

        $response = $this->get('/api/health', $this->app($unreachable));

        self::assertSame(500, $response->getStatusCode());
        self::assertSame('application/problem+json', $response->getHeaderLine('Content-Type'));
        $body = (string) $response->getBody();
        self::assertSame(
            ['type' => 'urn:performance:problem:internal', 'title' => 'Interner Fehler', 'status' => 500],
            $this->body($response),
        );
        self::assertStringNotContainsStringIgnoringCase('pdo', $body);
        self::assertStringNotContainsString('SQLSTATE', $body);
        self::assertStringNotContainsString('wrong-password-for-test', $body);
    }

    public function testNeverLetsCachesStoreApiResponses(): void
    {
        self::assertSame('no-store', $this->get('/api/health')->getHeaderLine('Cache-Control'));
        self::assertSame('no-store', $this->get('/api/nothing')->getHeaderLine('Cache-Control'));
    }
}
