<?php

declare(strict_types=1);

namespace Performance\Domain;

use PDO;
use PDOException;
use Throwable;

/**
 * A number that changes with every write that changes what the scoreboard sends
 * (entries, persons, drinks, factors). The write and its bump share one transaction,
 * so the revision changes exactly when committed data did; readers compare it
 * instead of aggregating again.
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
        return $this->retried(function () use ($change) {
            $result = $change();
            $this->bump();

            return $result;
        });
    }

    /**
     * Runs a change like write, but bumps the revision only when the change reports that it
     * changed something. An unchanged change still commits, which releases its locks, and is
     * retried on deadlock the same way.
     *
     * @param callable(): bool $change run once per attempt; true when it changed what the
     *                                 scoreboard sends; it must do nothing outside the database
     *
     * @return bool what the committed attempt of the change reported
     */
    public function writeIfChanged(callable $change): bool
    {
        return $this->retried(function () use ($change): bool {
            $changed = $change();
            if ($changed) {
                $this->bump();
            }

            return $changed;
        });
    }

    /**
     * Runs the transaction again while it loses deadlocks, up to ATTEMPTS times.
     *
     * @template T
     *
     * @param callable(): T $transaction
     *
     * @return T
     */
    private function retried(callable $transaction): mixed
    {
        for ($attempt = 1; ; ++$attempt) {
            try {
                return $this->once($transaction);
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
     * @param callable(): T $transaction
     *
     * @return T
     */
    private function once(callable $transaction): mixed
    {
        $this->pdo->beginTransaction();
        try {
            $result = $transaction();
            $this->pdo->commit();

            return $result;
        } catch (Throwable $failure) {
            $this->pdo->rollBack();
            throw $failure;
        }
    }

    /** Last in a transaction, so the row lock that serialises writers is held as briefly as possible. */
    private function bump(): void
    {
        $this->pdo->exec('INSERT INTO data_revision (id, revision) VALUES (1, 1) ON DUPLICATE KEY UPDATE revision = revision + 1');
    }
}
