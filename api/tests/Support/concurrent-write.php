<?php

declare(strict_types=1);

/*
 * One write in its own process, as a request running beside others would make it:
 *   php concurrent-write.php <role> <id> <account id>
 * Role `delete-person`, `delete-drink`, `delete-factor` or `delete-game` deletes that row;
 * `undo-entry`, `undo-match` and `undo-result` delete that entry, match or result;
 * `rename-person` renames that person to `Berta`, `set-photo` sets their photo to
 * photos/progressive.jpg and `remove-photo` removes it; `verify-entry`, `verify-match` and
 * `verify-result` verify that entry, match or result as the account, `reject-entry`,
 * `reject-match` and `reject-result` reject it as the account, and `delete-account` deletes that
 * account. Exits 0 when the write succeeded, 3 when its row was not found (gone already) and 4
 * when a rejection found the row verified already; any other failure ends the process with its
 * message and a non-zero code.
 * Connects with the DB_* environment of the test run.
 */

use Performance\Domain\Actor;
use Performance\Domain\AlreadyVerified;
use Performance\Domain\AuditLog;
use Performance\Domain\DataRevision;
use Performance\Domain\EntryLedger;
use Performance\Domain\Idempotency;
use Performance\Domain\NotFound;
use Performance\Domain\SystemClock;
use Performance\Domain\VerifiableKind;
use Performance\Http\Config;
use Performance\Http\Database;

require __DIR__ . '/../../vendor/autoload.php';
require __DIR__ . '/cli-arguments.php';

const NOT_FOUND = 3;
const ALREADY_VERIFIED = 4;

[$role, $id, $accountId] = cliArguments(3);
$env = static fn(string $name): string => (string) getenv($name);
// The API's own session setup (Database::open), as a request would have.
$config = new Config(
    sprintf('mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4', $env('DB_HOST'), $env('DB_PORT'), $env('DB_NAME')),
    $env('DB_USER'),
    $env('DB_PASS'),
    'race',
    [],
);
$pdo = Database::open($config);
$clock = new SystemClock();
$revision = new DataRevision($pdo);
$audit = new AuditLog($pdo, $clock);
$actor = new Actor((int) $accountId, 'race');
// The catalog as the composition root wires it, with the dependents of a person.
$catalog = (new Database($config, $clock))->catalog();

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
        case 'delete-game':
            // Games and Matches as the composition root wires them, on their own session.
            (new Database($config, $clock))->games()->delete($actor, (int) $id);
            break;
        case 'undo-match':
            (new Database($config, $clock))->matches()->delete($actor, $id);
            break;
        case 'undo-result':
            (new Database($config, $clock))->results()->delete($actor, $id);
            break;
        case 'rename-person':
            $catalog->updatePerson($actor, (int) $id, 'Berta');
            break;
        case 'set-photo':
            (new Database($config, $clock))->personPhotos()->set($actor, (int) $id, (string) file_get_contents(__DIR__ . '/photos/progressive.jpg'));
            break;
        case 'remove-photo':
            (new Database($config, $clock))->personPhotos()->remove($actor, (int) $id);
            break;
        case 'verify-entry':
        case 'verify-match':
        case 'verify-result':
            (new Database($config, $clock))->verification()->verify($actor, VerifiableKind::from(substr($role, strlen('verify-'))), $id);
            break;
        case 'reject-entry':
        case 'reject-match':
        case 'reject-result':
            (new Database($config, $clock))->verification()->reject($actor, VerifiableKind::from(substr($role, strlen('reject-'))), $id);
            break;
        case 'delete-account':
            (new Database($config, $clock))->accounts()->delete((int) $id);
            break;
        case 'undo-entry':
            (new EntryLedger($pdo, $clock, $revision, $audit, new Idempotency($pdo, $revision)))->delete($actor, $id);
            break;
        default:
            throw new RuntimeException("Unknown role {$role}");
    }
} catch (NotFound) {
    exit(NOT_FOUND);
} catch (AlreadyVerified) {
    exit(ALREADY_VERIFIED);
}
exit(0);
