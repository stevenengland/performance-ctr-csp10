<?php

declare(strict_types=1);

namespace Performance\Domain;

use PDO;
use PDOException;
use Throwable;

/**
 * A number that changes with every write that can change results (entries,
 * persons, drinks, factors). The write and its bump share one transaction, so the
 * revision changes exactly when committed data did; readers compare it instead
 * of aggregating again.
 */
final readonly class DataRevision
{
    /** How often a change runs when it keeps losing deadlocks; the last loss is thrown. */
    public const ATTEMPTS = 3;

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
     * A deadlock victim is rolled back whole by the server, so the whole change runs again in
     * a new transaction, up to ATTEMPTS times: it reads and locks afresh and records what it
     * finds then (a row another transaction removed meanwhile is then simply not found). Two
     * writes whose lock orders cannot be made to agree (an entry undo locks the entry before its
     * person, drink and factor; a deletion of one of those locks it before its entries) end this
     * way instead of failing the request.
     *
     * @template T
     *
     * @param callable(): T $change run once per attempt; it must do nothing outside the database
     *
     * @return T
     */
    public function write(callable $change): mixed
    {
        for ($attempt = 1; ; ++$attempt) {
            try {
                return $this->once($change);
            } catch (PDOException $failure) {
                if ($attempt === self::ATTEMPTS || !DatabaseError::is($failure, DatabaseError::DEADLOCK)) {
                    throw $failure;
                }
            }
        }
    }

    /**
     * @template T
     *
     * @param callable(): T $change
     *
     * @return T
     */
    private function once(callable $change): mixed
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
