<?php

declare(strict_types=1);

namespace Performance\Tests\Integration;

use PDO;
use PDOException;
use Performance\Domain\DataRevision;
use Performance\Tests\Support\DatabaseTestCase;
use PHPUnit\Framework\Attributes\DataProvider;
use RuntimeException;

/**
 * The revision transaction: `write` always bumps, `writeIfChanged` only when its change says
 * it changed something; both roll back a change that throws and run a deadlock victim again.
 */
final class DataRevisionTest extends DatabaseTestCase
{
    private const PERSON = 1;

    private PDO $pdo;
    private DataRevision $revision;

    protected function setUp(): void
    {
        parent::setUp();
        $response = $this->send('POST', '/api/persons', ['name' => 'Anna'], $this->signIn());
        self::assertSame(201, $response->getStatusCode(), (string) $response->getBody());
        $this->pdo = $this->otherSession();
        $this->revision = new DataRevision($this->pdo);
    }

    public function testAChangedWriteCommitsItsWritesAndBumpsTheRevisionByOne(): void
    {
        $before = $this->revision->current();

        $changed = $this->revision->writeIfChanged(function (): bool {
            $this->rename('Berta');

            return true;
        });

        self::assertTrue($changed);
        self::assertSame('Berta', $this->storedName());
        self::assertSame($before + 1, $this->revision->current());
    }

    /**
     * The change decides what counts: one that writes yet reports no change (nothing the
     * scoreboard sends) is committed, not rolled back, and its row locks go with the commit.
     */
    public function testAnUnchangedWriteCommitsReleasesItsLocksAndLeavesTheRevision(): void
    {
        $before = $this->revision->current();

        $changed = $this->revision->writeIfChanged(function (): bool {
            $this->rename('Berta');

            return false;
        });

        self::assertFalse($changed);
        self::assertFalse($this->pdo->inTransaction(), 'the transaction ended');
        self::assertSame('Berta', $this->storedName(), 'committed');
        self::assertTrue($this->lockable(), 'the person row is no longer locked');
        self::assertSame($before, $this->revision->current());
    }

    /**
     * Both variants, each with a change that reports a change.
     *
     * @return iterable<string, array{callable(DataRevision, callable(): bool): mixed}>
     */
    public static function variants(): iterable
    {
        yield 'write' => [
            /** @param callable(): bool $change */
            static fn(DataRevision $revision, callable $change): mixed => $revision->write($change),
        ];
        yield 'writeIfChanged' => [
            /** @param callable(): bool $change */
            static fn(DataRevision $revision, callable $change): bool => $revision->writeIfChanged($change),
        ];
    }

    /**
     * @param callable(DataRevision, callable(): bool): mixed $run
     */
    #[DataProvider('variants')]
    public function testAChangeThatThrowsRollsBackWithoutABump(callable $run): void
    {
        $before = $this->revision->current();

        try {
            $run($this->revision, function (): bool {
                $this->rename('Berta');

                throw new RuntimeException('the change failed');
            });
            self::fail('the failure reaches the caller');
        } catch (RuntimeException $failure) {
            self::assertSame('the change failed', $failure->getMessage());
        }

        self::assertFalse($this->pdo->inTransaction(), 'rolled back');
        self::assertSame('Anna', $this->storedName());
        self::assertSame($before, $this->revision->current());
    }

    /**
     * @param callable(DataRevision, callable(): bool): mixed $run
     */
    #[DataProvider('variants')]
    public function testADeadlockVictimRunsAgainWholeInANewTransaction(callable $run): void
    {
        $before = $this->revision->current();
        $attempts = 0;

        $run($this->revision, function () use (&$attempts): bool {
            ++$attempts;
            $this->pdo->exec("UPDATE persons SET name = CONCAT(name, '!') WHERE id = " . self::PERSON);
            if ($attempts === 1) {
                throw self::deadlock();
            }

            return true;
        });

        self::assertSame(2, $attempts);
        self::assertSame('Anna!', $this->storedName(), 'the lost attempt was rolled back');
        self::assertSame($before + 1, $this->revision->current());
    }

    /**
     * @param callable(DataRevision, callable(): bool): mixed $run
     */
    #[DataProvider('variants')]
    public function testTheLastDeadlockIsThrownAfterEveryAttemptLost(callable $run): void
    {
        $before = $this->revision->current();
        $attempts = 0;

        try {
            $run($this->revision, function () use (&$attempts): bool {
                ++$attempts;
                $this->rename('Berta');

                throw self::deadlock();
            });
            self::fail('the last deadlock reaches the caller');
        } catch (PDOException $failure) {
            self::assertSame(1213, $failure->errorInfo[1] ?? null);
        }

        self::assertSame(DataRevision::ATTEMPTS, $attempts);
        self::assertSame('Anna', $this->storedName());
        self::assertSame($before, $this->revision->current());
    }

    public function testAnUnchangedDeadlockVictimRunsAgainWithoutABump(): void
    {
        $before = $this->revision->current();
        $attempts = 0;

        $changed = $this->revision->writeIfChanged(static function () use (&$attempts): bool {
            if (++$attempts === 1) {
                throw self::deadlock();
            }

            return false;
        });

        self::assertFalse($changed);
        self::assertSame(2, $attempts);
        self::assertSame($before, $this->revision->current());
    }

    /** What the server reports to the victim of a deadlock it resolved. */
    private static function deadlock(): PDOException
    {
        $deadlock = new PDOException('SQLSTATE[40001]: Serialization failure: 1213 Deadlock found when trying to get lock');
        $deadlock->errorInfo = ['40001', 1213, 'Deadlock found when trying to get lock; try restarting transaction'];

        return $deadlock;
    }

    private function rename(string $name): void
    {
        $this->pdo->prepare('UPDATE persons SET name = ? WHERE id = ?')->execute([$name, self::PERSON]);
    }

    /** The person's committed name, as another request reads it. */
    private function storedName(): mixed
    {
        return $this->rows('SELECT name FROM persons WHERE id = ' . self::PERSON)[0]['name'] ?? null;
    }

    /** Whether another request can lock the person row right away. */
    private function lockable(): bool
    {
        $other = $this->otherSession();
        $other->beginTransaction();
        try {
            $other->query('SELECT id FROM persons WHERE id = ' . self::PERSON . ' FOR UPDATE NOWAIT');

            return true;
        } catch (PDOException) {
            return false;
        } finally {
            $other->rollBack();
        }
    }
}
