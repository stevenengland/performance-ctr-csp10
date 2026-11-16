<?php

declare(strict_types=1);

namespace Performance\Tests\Integration;

use PDO;
use Performance\Domain\Accounts;
use Performance\Domain\SystemClock;
use Performance\Tests\Support\DatabaseTestCase;

final class BootstrapTest extends DatabaseTestCase
{
    public function testCreatesTheConfiguredBootstrapAdminWhenNoAdminExists(): void
    {
        $response = $this->send('POST', '/api/session', ['userName' => self::ADMIN, 'password' => self::ADMIN_PASSWORD]);

        self::assertSame(200, $response->getStatusCode());
        self::assertSame(['id' => 1, 'userName' => self::ADMIN, 'isAdmin' => true], $this->body($response));
    }

    public function testCreatesNoAccountWithoutAConfiguredBootstrapAdmin(): void
    {
        $app = $this->app($this->configWith(null));

        $response = $this->send('POST', '/api/session', ['userName' => self::ADMIN, 'password' => self::ADMIN_PASSWORD], app: $app);

        self::assertSame(401, $response->getStatusCode());
        self::assertSame([], $this->rows('SELECT id FROM accounts'));
    }

    public function testNeverOverwritesAnExistingAccountWithTheBootstrapName(): void
    {
        $this->get('/api/health');
        $this->accounts()->create('Chef', 'eigenes-passwort');

        $bootstrap = $this->send('POST', '/api/session', ['userName' => self::ADMIN, 'password' => self::ADMIN_PASSWORD]);

        self::assertSame(401, $bootstrap->getStatusCode());
        self::assertSame(
            ['id' => 1, 'userName' => 'Chef', 'isAdmin' => false],
            $this->body($this->send('GET', '/api/session', session: $this->signIn('chef', 'eigenes-passwort'))),
        );
        self::assertCount(1, $this->rows('SELECT id FROM accounts'));
    }

    public function testDoesNothingWhileAnyAdminExists(): void
    {
        $this->signIn();
        $other = $this->app($this->configWith(self::bootstrapAdmin('zweiter-chef', 'anderes-passwort')));

        $response = $this->send('POST', '/api/session', ['userName' => 'zweiter-chef', 'password' => 'anderes-passwort'], app: $other);

        self::assertSame(401, $response->getStatusCode());
        self::assertSame([['user_name' => self::ADMIN]], $this->rows('SELECT user_name FROM accounts'));
    }

    public function testParallelFirstRequestsCreateExactlyOneBootstrapAccount(): void
    {
        $this->get('/api/health');
        $script = __DIR__ . '/../Support/bootstrap-race.php';
        $startAt = microtime(true) + 1.0;
        $processes = [];
        for ($i = 0; $i < 8; ++$i) {
            $process = proc_open(
                [PHP_BINARY, $script, (string) $startAt, self::ADMIN, self::bootstrapAdmin()->passwordHash],
                [1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
                $pipes,
            );
            self::assertIsResource($process);
            $processes[] = [$process, $pipes];
        }
        foreach ($processes as [$process, $pipes]) {
            $errors = stream_get_contents($pipes[2]);
            fclose($pipes[1]);
            fclose($pipes[2]);
            self::assertSame(0, proc_close($process), (string) $errors);
        }

        self::assertSame(
            [['user_name' => self::ADMIN, 'is_admin' => 1]],
            $this->rows('SELECT user_name, is_admin FROM accounts'),
        );
    }

    private function accounts(): Accounts
    {
        $pdo = $this->otherSession();
        $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);

        return new Accounts($pdo, new SystemClock());
    }
}
