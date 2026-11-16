<?php

declare(strict_types=1);

/*
 * One of several processes that ask for the bootstrap admin at the same instant:
 *   php bootstrap-race.php <start at (unix time)> <user name> <password hash>
 * Connects with the DB_* environment of the test run.
 */

use Performance\Domain\Accounts;
use Performance\Domain\BootstrapAdmin;
use Performance\Domain\SystemClock;
use Performance\Http\Config;
use Performance\Http\Database;

require __DIR__ . '/../../vendor/autoload.php';
require __DIR__ . '/cli-arguments.php';

[$startAt, $userName, $passwordHash] = cliArguments(3);
$env = static fn(string $name): string => (string) getenv($name);
// The API's own session setup (Database::open), as a request would have.
$pdo = Database::open(new Config(
    sprintf('mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4', $env('DB_HOST'), $env('DB_PORT'), $env('DB_NAME')),
    $env('DB_USER'),
    $env('DB_PASS'),
    'race',
    [],
));
$accounts = new Accounts($pdo, new SystemClock());
time_sleep_until((float) $startAt);
$accounts->ensureBootstrapAdmin(new BootstrapAdmin($userName, $passwordHash));
