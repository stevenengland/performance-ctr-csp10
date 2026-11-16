<?php

declare(strict_types=1);

/*
 * One of several processes that write a match or its game at the same instant, as requests
 * running beside each other would:
 *   php match-race.php <start at (unix time)> <role> <match id> <game id> <first person id> <second person id> <outcome> <account id>
 * Role `record` records the match, `undo` deletes it, `delete-game` deletes the game,
 * `restart` restarts it and `delete-person` deletes the first person; the persons matter to
 * `record` and `delete-person` only, the outcome to `record` only. Prints the
 * outcome: created, replayed, conflict, not-found, invalid or done. Connects with the DB_*
 * environment of the test run.
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

[$startAt, $role, $matchId, $gameId, $firstPersonId, $secondPersonId, $outcome, $accountId] = cliArguments(8);
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
            $recorded = $database->matches()->record($actor, $matchId, (int) $gameId, (int) $firstPersonId, (int) $secondPersonId, $outcome);
            echo $recorded->created ? 'created' : 'replayed';
            break;
        case 'undo':
            $database->matches()->delete($actor, $matchId);
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
            $database->catalog()->deletePerson($actor, (int) $firstPersonId);
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
