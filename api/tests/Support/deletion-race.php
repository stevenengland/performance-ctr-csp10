<?php

declare(strict_types=1);

/*
 * One of several processes that race a person, drink or factor deletion against entry adds:
 *   php deletion-race.php <start at (unix time)> <role> <person id> <drink id> <factor id, 0 for none> <account id>
 * Role `delete-person`, `delete-drink` or `delete-factor` deletes that one of the given rows.
 * Role `add` adds entries of the given person, drink and factor, one after the other, until
 * one is refused because a row it references is gone, or ADDS were added.
 * Connects with the DB_* environment of the test run.
 */

use Performance\Domain\Actor;
use Performance\Domain\AuditLog;
use Performance\Domain\Catalog\Catalog;
use Performance\Domain\DataRevision;
use Performance\Domain\EntryLedger;
use Performance\Domain\Idempotency;
use Performance\Domain\SystemClock;
use Performance\Domain\ValidationFailed;
use Performance\Http\Config;
use Performance\Http\Database;

require __DIR__ . '/../../vendor/autoload.php';
require __DIR__ . '/cli-arguments.php';

const ADDS = 25;

[$startAt, $role, $personId, $drinkId, $factorId, $accountId] = cliArguments(6);
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
time_sleep_until((float) $startAt);

if ($role === 'add') {
    $ledger = new EntryLedger($pdo, $clock, $revision, $audit, new Idempotency($pdo, $revision));
    $factor = (int) $factorId === 0 ? null : (int) $factorId;
    for ($added = 0; $added < ADDS; ++$added) {
        $bytes = random_bytes(16);
        $bytes[6] = chr(ord($bytes[6]) & 0x0F | 0x40);
        $bytes[8] = chr(ord($bytes[8]) & 0x3F | 0x80);
        try {
            $ledger->add($actor, vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($bytes), 4)), (int) $personId, (int) $drinkId, 1, $factor);
        } catch (ValidationFailed) {
            break;
        }
    }
    exit(0);
}

$catalog = new Catalog($pdo, $clock, $revision, $audit);
switch ($role) {
    case 'delete-person':
        $catalog->deletePerson($actor, (int) $personId);
        break;
    case 'delete-drink':
        $catalog->deleteDrink($actor, (int) $drinkId);
        break;
    case 'delete-factor':
        $catalog->deleteFactor($actor, (int) $factorId);
        break;
    default:
        throw new RuntimeException("Unknown role {$role}");
}
