<?php

declare(strict_types=1);

/*
 * One of two processes that demote or delete an admin at the same instant:
 *   php last-admin-race.php <start at (unix time)> <demote|delete> <account id>
 * Connects with the DB_* environment of the test run. Exits 0 when the change was
 * made and 3 when it was refused because the account was the last admin.
 */

use Performance\Domain\Accounts;
use Performance\Domain\DataRevision;
use Performance\Domain\LastAdmin;
use Performance\Domain\SystemClock;
use Performance\Http\Config;
use Performance\Http\Database;

require __DIR__ . '/../../vendor/autoload.php';
require __DIR__ . '/cli-arguments.php';

[$startAt, $action, $accountId] = cliArguments(3);
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
$accounts = new Accounts($pdo, new SystemClock(), new DataRevision($pdo));
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
