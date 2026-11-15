<?php

declare(strict_types=1);

use Performance\Domain\Migration;
use Performance\Domain\Migrator;

/*
 * Fails unless, while its DDL would run, this session holds the migration lock
 * and the migration is already recorded as started: a green run proves both.
 */
return new class implements Migration {
    public function isApplied(PDO $pdo): bool
    {
        return false;
    }

    public function apply(PDO $pdo): void
    {
        $lock = $pdo->prepare('SELECT IS_USED_LOCK(?) = CONNECTION_ID()');
        $lock->execute([Migrator::lockName($pdo)]);
        if ((int) $lock->fetchColumn() !== 1) {
            throw new RuntimeException('The migration lock is not held by this session');
        }
        $state = $pdo->query("SELECT state FROM schema_migrations WHERE version = '0002_require_the_lock'");
        if ($state === false || $state->fetchColumn() !== 'started') {
            throw new RuntimeException('The migration was not recorded as started before its DDL');
        }
    }
};
