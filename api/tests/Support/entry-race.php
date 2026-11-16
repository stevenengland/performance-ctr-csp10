<?php

declare(strict_types=1);

/*
 * One of several processes that send an entry under the same id at the same instant:
 *   php entry-race.php <start at (unix time)> <entry id> <person id> <drink id> <quantity> <account id>
 * Prints its outcome: created, replayed or conflict. Connects with the DB_* environment of the test run.
 */

use Performance\Domain\Actor;
use Performance\Domain\AuditLog;
use Performance\Domain\DataRevision;
use Performance\Domain\EntryConflict;
use Performance\Domain\EntryLedger;
use Performance\Domain\Idempotency;
use Performance\Domain\SystemClock;
use Performance\Http\Config;
use Performance\Http\Database;

require __DIR__ . '/../../vendor/autoload.php';
require __DIR__ . '/cli-arguments.php';

[$startAt, $id, $personId, $drinkId, $quantity, $accountId] = cliArguments(6);
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
$revision = new DataRevision($pdo);
$ledger = new EntryLedger($pdo, $clock, $revision, new AuditLog($pdo, $clock), new Idempotency($pdo, $revision));
time_sleep_until((float) $startAt);
try {
    $added = $ledger->add(new Actor((int) $accountId, 'race'), $id, (int) $personId, (int) $drinkId, (int) $quantity, null);
    echo $added->created ? 'created' : 'replayed';
} catch (EntryConflict) {
    echo 'conflict';
}
