<?php

declare(strict_types=1);

/*
 * One sign-in in its own process, while the test holds a password reset open on
 * another connection:
 *   php sign-in-paused.php <user name> <password>
 * Connects with the DB_* environment of the test run. Exits 0 when it was issued a
 * session and 2 when the credentials were refused.
 */

use Performance\Domain\Accounts;
use Performance\Domain\InvalidCredentials;
use Performance\Domain\Sessions;
use Performance\Domain\SystemClock;
use Performance\Http\Config;
use Performance\Http\Database;

require __DIR__ . '/../../vendor/autoload.php';
require __DIR__ . '/cli-arguments.php';

[$userName, $password] = cliArguments(2);
$env = static fn(string $name): string => (string) getenv($name);
// The API's own session setup (Database::open), as a request would have.
$pdo = Database::open(new Config(
    sprintf('mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4', $env('DB_HOST'), $env('DB_PORT'), $env('DB_NAME')),
    $env('DB_USER'),
    $env('DB_PASS'),
    'race',
    [],
));
$pdo->exec("SET time_zone = '+00:00'");
$clock = new SystemClock();
$sessions = new Sessions($pdo, new Accounts($pdo, $clock), $clock);
try {
    $sessions->signIn($userName, $password, '192.0.2.77');
} catch (InvalidCredentials) {
    exit(2);
}
exit(0);
