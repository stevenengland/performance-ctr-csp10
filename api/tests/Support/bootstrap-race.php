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

require __DIR__ . '/../../vendor/autoload.php';

[, $startAt, $userName, $passwordHash] = $argv;
$env = static fn(string $name): string => (string) getenv($name);
$pdo = new PDO(
    sprintf('mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4', $env('DB_HOST'), $env('DB_PORT'), $env('DB_NAME')),
    $env('DB_USER'),
    $env('DB_PASS'),
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION],
);
$accounts = new Accounts($pdo, new SystemClock());
time_sleep_until((float) $startAt);
$accounts->ensureBootstrapAdmin(new BootstrapAdmin($userName, $passwordHash));
