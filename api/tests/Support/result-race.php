<?php

declare(strict_types=1);

/*
 * One of several processes that write a result, its game or its person at the same instant,
 * as requests running beside each other would:
 *   php result-race.php <start at (unix time)> <role> <result id> <game id> <person id> <points> <account id>
 * Role `record` records the result, `undo` deletes it, `delete-game` deletes the game,
 * `restart` restarts it and `delete-person` deletes the person; the points matter to `record`
 * only. Prints the outcome: created, replayed, conflict, not-found, invalid or done. Connects
 * with the DB_* environment of the test run.
 */

use Performance\Domain\Actor;
use Performance\Domain\NotFound;
use Performance\Domain\RequestConflict;
use Performance\Domain\SystemClock;
use Performance\Domain\ValidationFailed;
use Performance\Http\Config;
use Performance\Http\Database;

require __DIR__ . '/../../vendor/autoload.php';
require __DIR__ . '/cli-arguments.php';

[$startAt, $role, $resultId, $gameId, $personId, $points, $accountId] = cliArguments(7);
$env = static fn(string $name): string => (string) getenv($name);
// The composition root's modules on the API's own session setup, as a request would have them.
$database = new Database(new Config(
    sprintf('mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4', $env('DB_HOST'), $env('DB_PORT'), $env('DB_NAME')),
    $env('DB_USER'),
    $env('DB_PASS'),
    'race',
    [],
), new SystemClock());
$database->pdo();
$actor = new Actor((int) $accountId, 'race');
time_sleep_until((float) $startAt);
try {
    switch ($role) {
        case 'record':
            $recorded = $database->results()->record($actor, $resultId, (int) $gameId, (int) $personId, (int) $points);
            echo $recorded->created ? 'created' : 'replayed';
            break;
        case 'undo':
            $database->results()->delete($actor, $resultId);
            echo 'done';
            break;
        case 'delete-game':
            $database->games()->delete($actor, (int) $gameId);
            echo 'done';
            break;
        case 'restart':
            $database->games()->restart($actor, (int) $gameId);
            echo 'done';
            break;
        case 'delete-person':
            $database->catalog()->deletePerson($actor, (int) $personId);
            echo 'done';
            break;
        default:
            throw new RuntimeException("Unknown role {$role}");
    }
} catch (RequestConflict) {
    echo 'conflict';
} catch (NotFound) {
    echo 'not-found';
} catch (ValidationFailed) {
    echo 'invalid';
}
