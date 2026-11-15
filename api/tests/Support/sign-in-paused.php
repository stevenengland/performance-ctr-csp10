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

require __DIR__ . '/../../vendor/autoload.php';

[, $userName, $password] = $argv;
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
try {
    $sessions->signIn($userName, $password, '192.0.2.77');
} catch (InvalidCredentials) {
    exit(2);
}
exit(0);
