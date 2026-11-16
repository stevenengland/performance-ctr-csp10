<?php

declare(strict_types=1);

/*
 * One `GET /api/session` through the whole application in its own process, as a request
 * running beside a revocation would make it:
 *   php session-request.php <session token> <now, as the clock reads it>
 * Connects with the DB_* environment of the test run and prints the status and the
 * Set-Cookie header as JSON.
 */

use Performance\Http\App;
use Performance\Http\Config;
use Performance\Tests\Support\TestClock;
use Slim\Psr7\Factory\ServerRequestFactory;

require __DIR__ . '/../../vendor/autoload.php';
require __DIR__ . '/cli-arguments.php';

[$token, $now] = cliArguments(2);
$env = static fn(string $name): string => (string) getenv($name);
$app = App::create(
    new Config(
        sprintf('mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4', $env('DB_HOST'), $env('DB_PORT'), $env('DB_NAME')),
        $env('DB_USER'),
        $env('DB_PASS'),
        'race',
        [dirname(__DIR__, 2) . '/migrations'],
    ),
    clock: new TestClock($now),
);
$request = (new ServerRequestFactory())->createServerRequest('GET', '/api/session')
    ->withCookieParams(['session' => $token])
    ->withHeader('Cookie', "session={$token}");
$response = $app->handle($request);
echo json_encode(['status' => $response->getStatusCode(), 'setCookie' => $response->getHeaderLine('Set-Cookie')], JSON_THROW_ON_ERROR);
