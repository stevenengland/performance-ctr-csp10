<?php

declare(strict_types=1);

namespace Performance\Domain;

use PDO;

/**
 * One consistent view of the committed data for several reads: a read-only REPEATABLE READ
 * transaction whose snapshot is taken when it starts. A ranking read together with the data
 * revision belongs to exactly that revision, whatever other requests commit meanwhile, so an
 * ETag made from the revision always names the body sent with it.
 */
final readonly class Snapshot
{
    public function __construct(private PDO $pdo) {}

    /**
     * @template T
     *
     * @param callable(): T $read
     *
     * @return T
     */
    public function read(callable $read): mixed
    {
        $this->pdo->exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        $this->pdo->exec('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
        try {
            return $read();
        } finally {
            $this->pdo->exec('COMMIT');
        }
    }
}
