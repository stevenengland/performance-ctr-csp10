<?php

declare(strict_types=1);

/*
 * One of many processes that sign in with a wrong password at the same instant:
 *   php sign-in-race.php <start at (unix time)> <user name> <client address>
 * Connects with the DB_* environment of the test run. Exits 0 when the password was
 * checked (and was wrong) and 3 when the attempt was refused by the throttle.
 */

use Performance\Domain\Accounts;
use Performance\Domain\DataRevision;
use Performance\Domain\InvalidCredentials;
use Performance\Domain\Sessions;
use Performance\Domain\SystemClock;
use Performance\Domain\TooManyAttempts;
use Performance\Http\Config;
use Performance\Http\Database;

require __DIR__ . '/../../vendor/autoload.php';
require __DIR__ . '/cli-arguments.php';

[$startAt, $userName, $clientAddress] = cliArguments(3);
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
$sessions = new Sessions($pdo, new Accounts($pdo, $clock, new DataRevision($pdo)), $clock);
time_sleep_until((float) $startAt);
try {
    $sessions->signIn($userName, 'falsches-passwort', $clientAddress);
} catch (InvalidCredentials) {
    exit(0);
} catch (TooManyAttempts) {
    exit(3);
}
exit(1);
