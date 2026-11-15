<?php

declare(strict_types=1);

/*
 * One of two processes that demote or delete an admin at the same instant:
 *   php last-admin-race.php <start at (unix time)> <demote|delete> <account id>
 * Connects with the DB_* environment of the test run. Exits 0 when the change was
 * made and 3 when it was refused because the account was the last admin.
 */

use Performance\Domain\Accounts;
use Performance\Domain\LastAdmin;
use Performance\Domain\SystemClock;

require __DIR__ . '/../../vendor/autoload.php';

[, $startAt, $action, $accountId] = $argv;
$env = static fn(string $name): string => (string) getenv($name);
$pdo = new PDO(
    sprintf('mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4', $env('DB_HOST'), $env('DB_PORT'), $env('DB_NAME')),
    $env('DB_USER'),
    $env('DB_PASS'),
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false],
);
$pdo->exec("SET time_zone = '+00:00'");
$accounts = new Accounts($pdo, new SystemClock());
time_sleep_until((float) $startAt);
try {
    if ($action === 'delete') {
        $accounts->delete((int) $accountId);
    } else {
        $accounts->update((int) $accountId, false, null);
    }
} catch (LastAdmin) {
    exit(3);
}
