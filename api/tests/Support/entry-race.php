<?php

declare(strict_types=1);

/*
 * One of several processes that send the same entry at the same instant:
 *   php entry-race.php <start at (unix time)> <entry id> <person id> <drink id> <quantity> <account id>
 * Connects with the DB_* environment of the test run.
 */

use Performance\Domain\DataRevision;
use Performance\Domain\EntryLedger;
use Performance\Domain\SystemClock;

require __DIR__ . '/../../vendor/autoload.php';

[, $startAt, $id, $personId, $drinkId, $quantity, $accountId] = $argv;
$env = static fn(string $name): string => (string) getenv($name);
$pdo = new PDO(
    sprintf('mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4', $env('DB_HOST'), $env('DB_PORT'), $env('DB_NAME')),
    $env('DB_USER'),
    $env('DB_PASS'),
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false],
);
$pdo->exec("SET time_zone = '+00:00'");
$ledger = new EntryLedger($pdo, new SystemClock(), new DataRevision($pdo));
time_sleep_until((float) $startAt);
$ledger->add($id, (int) $personId, (int) $drinkId, (int) $quantity, (int) $accountId);
