<?php

declare(strict_types=1);

/*
 * One write in its own process, as a request running beside others would make it:
 *   php concurrent-write.php <role> <id> <account id>
 * Role `delete-person`, `delete-drink` or `delete-factor` deletes that row; `undo-entry`
 * deletes that entry. Exits 0 when the write succeeded and 3 when its row was not found
 * (gone already); any other failure ends the process with its message and a non-zero code.
 * Connects with the DB_* environment of the test run.
 */

use Performance\Domain\Actor;
use Performance\Domain\AuditLog;
use Performance\Domain\Catalog\Catalog;
use Performance\Domain\DataRevision;
use Performance\Domain\EntryLedger;
use Performance\Domain\NotFound;
use Performance\Domain\SystemClock;
use Performance\Http\Config;
use Performance\Http\Database;

require __DIR__ . '/../../vendor/autoload.php';
require __DIR__ . '/cli-arguments.php';

const NOT_FOUND = 3;

[$role, $id, $accountId] = cliArguments(3);
$env = static fn(string $name): string => (string) getenv($name);
// The API's own session setup (Database::open), as a request would have.
$pdo = Database::open(new Config(
    sprintf('mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4', $env('DB_HOST'), $env('DB_PORT'), $env('DB_NAME')),
    $env('DB_USER'),
    $env('DB_PASS'),
    'race',
    [],
));
$clock = new SystemClock();
$revision = new DataRevision($pdo);
$audit = new AuditLog($pdo, $clock);
$actor = new Actor((int) $accountId, 'race');
$catalog = new Catalog($pdo, $clock, $revision, $audit);

try {
    switch ($role) {
        case 'delete-person':
            $catalog->deletePerson($actor, (int) $id);
            break;
        case 'delete-drink':
            $catalog->deleteDrink($actor, (int) $id);
            break;
        case 'delete-factor':
            $catalog->deleteFactor($actor, (int) $id);
            break;
        case 'undo-entry':
            (new EntryLedger($pdo, $clock, $revision, $audit))->delete($actor, $id);
            break;
        default:
            throw new RuntimeException("Unknown role {$role}");
    }
} catch (NotFound) {
    exit(NOT_FOUND);
}
exit(0);
