<?php

declare(strict_types=1);

namespace Performance\Domain;

use PDO;
use Throwable;

/**
 * A number that changes with every write that can change results (entries,
 * persons, drinks, factors). The write and its bump share one transaction, so the
 * revision changes exactly when committed data did; readers compare it instead
 * of aggregating again.
 */
final readonly class DataRevision
{
    public function __construct(private PDO $pdo) {}

    /** The current revision; 0 before the first write. */
    public function current(): int
    {
        $statement = $this->pdo->query('SELECT revision FROM data_revision WHERE id = 1');

        return $statement === false ? 0 : (int) $statement->fetchColumn();
    }

    /**
     * Runs a change in one transaction together with the revision bump; a change
     * that throws rolls back, bump included.
     *
     * @template T
     *
     * @param callable(): T $change
     *
     * @return T
     */
    public function write(callable $change): mixed
    {
        $this->pdo->beginTransaction();
        try {
            $result = $change();
            // Last, so the row lock that serialises writers is held as briefly as possible.
            $this->pdo->exec('INSERT INTO data_revision (id, revision) VALUES (1, 1) ON DUPLICATE KEY UPDATE revision = revision + 1');
            $this->pdo->commit();

            return $result;
        } catch (Throwable $failure) {
            $this->pdo->rollBack();
            throw $failure;
        }
    }
}
