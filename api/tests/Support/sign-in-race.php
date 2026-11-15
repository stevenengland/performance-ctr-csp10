<?php

declare(strict_types=1);

/*
 * One of many processes that sign in with a wrong password at the same instant:
 *   php sign-in-race.php <start at (unix time)> <user name> <client address>
 * Connects with the DB_* environment of the test run. Exits 0 when the password was
 * checked (and was wrong) and 3 when the attempt was refused by the throttle.
 */

use Performance\Domain\Accounts;
use Performance\Domain\InvalidCredentials;
use Performance\Domain\Sessions;
use Performance\Domain\SystemClock;
use Performance\Domain\TooManyAttempts;

require __DIR__ . '/../../vendor/autoload.php';

[, $startAt, $userName, $clientAddress] = $argv;
$env = static fn(string $name): string => (string) getenv($name);
$pdo = new PDO(
    sprintf('mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4', $env('DB_HOST'), $env('DB_PORT'), $env('DB_NAME')),
    $env('DB_USER'),
    $env('DB_PASS'),
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false],
);
$pdo->exec("SET time_zone = '+00:00'");
$clock = new SystemClock();
$sessions = new Sessions($pdo, new Accounts($pdo, $clock), $clock);
time_sleep_until((float) $startAt);
try {
    $sessions->signIn($userName, 'falsches-passwort', $clientAddress);
} catch (InvalidCredentials) {
    exit(0);
} catch (TooManyAttempts) {
    exit(3);
}
exit(1);
