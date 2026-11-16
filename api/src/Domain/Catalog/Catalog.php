<?php

declare(strict_types=1);

namespace Performance\Domain\Catalog;

use LogicException;
use PDO;
use PDOException;
use Performance\Domain\Actor;
use Performance\Domain\AuditLog;
use Performance\Domain\AuditOperation;
use Performance\Domain\AuditSubjectKind;
use Performance\Domain\Clock;
use Performance\Domain\DatabaseError;
use Performance\Domain\DataRevision;
use Performance\Domain\EntrySnapshots;
use Performance\Domain\NotFound;
use Performance\Domain\Timestamp;
use Performance\Domain\ValidationFailed;
use RuntimeException;

/**
 * Persons, drinks and factors: names trimmed, 1–40 characters and unique regardless
 * of case (the table's collation and unique key decide); drinks carry alcohol base
 * points, factors a multiplier. Every write names its actor and is recorded in the audit
 * log in its own transaction, with the item's values before and after.
 */
final readonly class Catalog
{
    public const MAX_NAME_LENGTH = 40;
    public const MAX_POINTS = 9999.99;
    public const MAX_MULTIPLIER = 99.99;
    /** How long a deletion waits for the one before it; one of 50 000 entries took 1.5 s (runbook, "Audit log"). */
    private const DELETION_LOCK_SECONDS = 10;

    public function __construct(
        private PDO $pdo,
        private Clock $clock,
        private DataRevision $revision,
        private AuditLog $audit,
    ) {}

    /**
     * @throws ValidationFailed for a name outside 1–40 characters
     * @throws DuplicateName when the name is taken, ignoring case
     */
    public function createPerson(Actor $actor, string $name): Person
    {
        $name = self::validPerson($name);

        return new Person($this->insert($actor, AuditSubjectKind::Person, ['name' => $name]), $name);
    }

    /**
     * @throws ValidationFailed for a name outside 1–40 characters or points outside 0–9 999.99
     * @throws DuplicateName when the name is taken, ignoring case
     */
    public function createDrink(Actor $actor, string $name, int|float|null $points): Drink
    {
        [$name, $decimal] = self::validDrink($name, $points);

        return new Drink($this->insert($actor, AuditSubjectKind::Drink, ['name' => $name, 'points' => $decimal]), $name, $decimal);
    }

    /**
     * @throws ValidationFailed for a name outside 1–40 characters or a multiplier outside (0, 99.99]
     * @throws DuplicateName when the name is taken, ignoring case
     */
    public function createFactor(Actor $actor, string $name, int|float|null $multiplier): Factor
    {
        [$name, $decimal] = self::validFactor($name, $multiplier);

        return new Factor($this->insert($actor, AuditSubjectKind::Factor, ['name' => $name, 'multiplier' => $decimal]), $name, $decimal);
    }

    /**
     * @return list<Person> alphabetical, ignoring case
     */
    public function persons(): array
    {
        return array_map(
            static fn(array $row): Person => new Person((int) $row['id'], (string) $row['name']),
            $this->all('SELECT id, name FROM persons ORDER BY name, id'),
        );
    }

    /**
     * @return list<Drink> alphabetical, ignoring case
     */
    public function drinks(): array
    {
        return array_map(
            static fn(array $row): Drink => new Drink((int) $row['id'], (string) $row['name'], (string) $row['points']),
            $this->all('SELECT id, name, points FROM drinks ORDER BY name, id'),
        );
    }

    /**
     * @return list<Factor> alphabetical, ignoring case
     */
    public function factors(): array
    {
        return array_map(self::factorOf(...), $this->all('SELECT id, name, multiplier FROM factors ORDER BY name, id'));
    }

    /**
     * @throws NotFound when there is no such person
     */
    public function person(int $id): Person
    {
        $row = $this->one('SELECT id, name FROM persons WHERE id = ?', $id);

        return new Person((int) $row['id'], (string) $row['name']);
    }

    /**
     * @throws NotFound when there is no such drink
     */
    public function drink(int $id): Drink
    {
        $row = $this->one('SELECT id, name, points FROM drinks WHERE id = ?', $id);

        return new Drink((int) $row['id'], (string) $row['name'], (string) $row['points']);
    }

    /**
     * @throws NotFound when there is no such factor
     */
    public function factor(int $id): Factor
    {
        return self::factorOf($this->one('SELECT id, name, multiplier FROM factors WHERE id = ?', $id));
    }

    /** How many entries of every day are the person's: deleting the person deletes them. */
    public function entriesOfPerson(int $id): int
    {
        return $this->countEntries('person_id', $id);
    }

    /** How many entries of every day are of the drink: deleting the drink deletes them. */
    public function entriesOfDrink(int $id): int
    {
        return $this->countEntries('drink_id', $id);
    }

    /** How many entries of every day use the factor: deleting the factor makes them count ×1. */
    public function entriesWithFactor(int $id): int
    {
        return $this->countEntries('factor_id', $id);
    }

    /**
     * Renames a person; scores and lists show the new name from then on.
     *
     * @throws ValidationFailed like createPerson
     * @throws DuplicateName when another person has the name, ignoring case
     * @throws NotFound when there is no such person
     */
    public function updatePerson(Actor $actor, int $id, string $name): Person
    {
        $name = self::validPerson($name);
        $this->update($actor, AuditSubjectKind::Person, $id, ['name' => $name]);

        return new Person($id, $name);
    }

    /**
     * Changes a drink; its entries count with the new points from then on, every day included.
     *
     * @throws ValidationFailed like createDrink
     * @throws DuplicateName when another drink has the name, ignoring case
     * @throws NotFound when there is no such drink
     */
    public function updateDrink(Actor $actor, int $id, string $name, int|float|null $points): Drink
    {
        [$name, $decimal] = self::validDrink($name, $points);
        $this->update($actor, AuditSubjectKind::Drink, $id, ['name' => $name, 'points' => $decimal]);

        return new Drink($id, $name, $decimal);
    }

    /**
     * Changes a factor; its entries count with the new multiplier from then on, every day included.
     *
     * @throws ValidationFailed like createFactor
     * @throws DuplicateName when another factor has the name, ignoring case
     * @throws NotFound when there is no such factor
     */
    public function updateFactor(Actor $actor, int $id, string $name, int|float|null $multiplier): Factor
    {
        [$name, $decimal] = self::validFactor($name, $multiplier);
        $this->update($actor, AuditSubjectKind::Factor, $id, ['name' => $name, 'multiplier' => $decimal]);

        return new Factor($id, $name, $decimal);
    }

    /**
     * Deletes a person and all of the person's entries (the foreign key cascades).
     *
     * @throws NotFound when there is no such person
     */
    public function deletePerson(Actor $actor, int $id): void
    {
        $this->delete($actor, AuditSubjectKind::Person, $id);
    }

    /**
     * Deletes a drink and all of its entries (the foreign key cascades).
     *
     * @throws NotFound when there is no such drink
     */
    public function deleteDrink(Actor $actor, int $id): void
    {
        $this->delete($actor, AuditSubjectKind::Drink, $id);
    }

    /**
     * Deletes a factor; its entries stay and count ×1 (the foreign key sets them to no factor).
     *
     * @throws NotFound when there is no such factor
     */
    public function deleteFactor(Actor $actor, int $id): void
    {
        $this->delete($actor, AuditSubjectKind::Factor, $id);
    }

    /**
     * @throws ValidationFailed
     */
    private static function validPerson(string $name): string
    {
        $name = trim($name);
        if (!self::validName($name)) {
            throw new ValidationFailed(['name' => self::nameError()]);
        }

        return $name;
    }

    /**
     * @return array{string, string} the trimmed name and the points as a decimal with two places
     *
     * @throws ValidationFailed
     */
    private static function validDrink(string $name, int|float|null $points): array
    {
        $errors = [];
        $name = trim($name);
        if (!self::validName($name)) {
            $errors['name'] = self::nameError();
        }
        if ($points === null || !self::validDecimal($points, self::MAX_POINTS)) {
            $errors['points'] = 'Zahl von 0 bis 9.999,99.';
        }
        if ($errors !== []) {
            throw new ValidationFailed($errors);
        }

        return [$name, number_format((float) $points, 2, '.', '')];
    }

    /**
     * @return array{string, string} the trimmed name and the multiplier as a decimal with two places
     *
     * @throws ValidationFailed
     */
    private static function validFactor(string $name, int|float|null $multiplier): array
    {
        $errors = [];
        $name = trim($name);
        if (!self::validName($name)) {
            $errors['name'] = self::nameError();
        }
        if ($multiplier === null || $multiplier <= 0 || !self::validDecimal($multiplier, self::MAX_MULTIPLIER)) {
            $errors['multiplier'] = 'Zahl über 0 bis 99,99.';
        }
        if ($errors !== []) {
            throw new ValidationFailed($errors);
        }

        return [$name, number_format((float) $multiplier, 2, '.', '')];
    }

    private static function validName(string $name): bool
    {
        $length = mb_strlen($name, 'UTF-8');

        return $length >= 1 && $length <= self::MAX_NAME_LENGTH;
    }

    private static function nameError(): string
    {
        return sprintf('1 bis %d Zeichen.', self::MAX_NAME_LENGTH);
    }

    /** 0 to `$max` with at most two decimals. */
    private static function validDecimal(int|float $value, float $max): bool
    {
        if ($value < 0 || $value > $max) {
            return false;
        }
        $hundredths = $value * 100;

        return abs($hundredths - round($hundredths)) < 1e-6;
    }

    /**
     * Inserts a row, records its creation and bumps the revision, all in one transaction.
     *
     * @param array<string, string> $columns the item's values, which are also its snapshot
     *
     * @return int the new row's id
     */
    private function insert(Actor $actor, AuditSubjectKind $kind, array $columns): int
    {
        $now = Timestamp::of($this->clock->now());
        $names = [...array_keys($columns), 'created_at', 'updated_at'];
        $sql = sprintf(
            'INSERT INTO %s (%s) VALUES (%s)',
            self::table($kind),
            implode(', ', $names),
            implode(', ', array_fill(0, count($names), '?')),
        );
        try {
            return $this->revision->write(function () use ($actor, $kind, $sql, $columns, $now): int {
                $this->pdo->prepare($sql)->execute([...array_values($columns), $now, $now]);
                $id = (int) $this->pdo->lastInsertId();
                $this->audit->record($actor, AuditOperation::Create, $kind, (string) $id, null, $columns);

                return $id;
            });
        } catch (PDOException $failure) {
            throw self::duplicateOr($failure, $columns['name'] ?? '');
        }
    }

    /**
     * Changes a row's columns, records the change and bumps the revision, all in one transaction.
     *
     * @param array<string, string> $columns the item's new values, which are also its snapshot
     *
     * @throws NotFound when there is no such row
     * @throws DuplicateName when the new name is taken, ignoring case
     */
    private function update(Actor $actor, AuditSubjectKind $kind, int $id, array $columns): void
    {
        $now = Timestamp::of($this->clock->now());
        $table = self::table($kind);
        $assignments = implode(', ', array_map(static fn(string $column): string => "{$column} = ?", array_keys($columns)));
        try {
            $this->revision->write(function () use ($actor, $kind, $table, $id, $columns, $assignments, $now): void {
                // Locked first, so the values before are the ones this change replaces, and an
                // unchanged row (same values) is still told apart from a missing one.
                $before = $this->snapshot($kind, $id);
                $this->pdo->prepare("UPDATE {$table} SET {$assignments}, updated_at = ? WHERE id = ?")
                    ->execute([...array_values($columns), $now, $id]);
                $this->audit->record($actor, AuditOperation::Update, $kind, (string) $id, $before, $columns);
            });
        } catch (PDOException $failure) {
            throw self::duplicateOr($failure, $columns['name'] ?? '');
        }
    }

    /**
     * Deletes a row and records the deletion and what it does to the row's entries, then bumps
     * the revision, all in one transaction. The foreign keys still do the work on the entries:
     * a person's or a drink's are deleted with it, a factor's lose it. Each affected entry gets
     * its own event, caused by the deletion's.
     *
     * Lock order: the deletion lock first, then the row, then its entries, both for update; then
     * record; then delete. An entry insert takes a shared lock on its person, drink and factor
     * for its foreign key checks, so it either committed before the row was locked, and its
     * entry is read and recorded here, or it waits and then fails because the row is gone.
     *
     * The deletion lock lets one deletion run at a time. Without it, two deletions of different
     * rows that share an entry (its person and its drink, say) would each lock their row and
     * then wait for the other's: one locks the entry, the other its own row, and each needs
     * what the other holds to snapshot the entry. It is a named lock, taken before the
     * transaction holds any row, so no row lock ever waits for it.
     *
     * @throws NotFound when there is no such row
     */
    private function delete(Actor $actor, AuditSubjectKind $kind, int $id): void
    {
        $this->oneDeletionAtATime(function () use ($actor, $kind, $id): void {
            $this->revision->write(function () use ($actor, $kind, $id): void {
                $before = $this->snapshot($kind, $id);
                // A factor's entries stay and lose it; a person's or a drink's go with it.
                $clearsFactor = $kind === AuditSubjectKind::Factor;
                $entries = [];
                foreach (EntrySnapshots::lockReferencing($this->pdo, $kind, $id) as [$entryId, $entry]) {
                    $entries[] = [$entryId, $entry, $clearsFactor ? [...$entry, 'factor' => null] : null];
                }
                $this->audit->recordDeletion(
                    $actor,
                    $kind,
                    (string) $id,
                    $before,
                    $clearsFactor ? AuditOperation::Update : AuditOperation::Delete,
                    $entries,
                );
                $this->pdo->prepare('DELETE FROM ' . self::table($kind) . ' WHERE id = ?')->execute([$id]);
            });
        });
    }

    /**
     * Runs a deletion while this session holds the deletion lock, and releases it afterwards,
     * also when the deletion fails. The lock is server-wide, so its name carries the database's.
     *
     * @param callable(): void $deletion
     *
     * @throws RuntimeException when another deletion holds the lock for longer than DELETION_LOCK_SECONDS
     */
    private function oneDeletionAtATime(callable $deletion): void
    {
        $statement = $this->pdo->query('SELECT DATABASE()');
        $database = $statement === false ? null : $statement->fetchColumn();
        $lock = 'performance.catalog-deletion.' . substr(is_string($database) ? $database : '', 0, 32);
        $acquire = $this->pdo->prepare('SELECT GET_LOCK(?, ?)');
        $acquire->execute([$lock, self::DELETION_LOCK_SECONDS]);
        if ((int) $acquire->fetchColumn() !== 1) {
            throw new RuntimeException("Another deletion held {$lock} for longer than " . self::DELETION_LOCK_SECONDS . ' seconds');
        }
        try {
            $deletion();
        } finally {
            $this->pdo->prepare('SELECT RELEASE_LOCK(?)')->execute([$lock]);
        }
    }

    /**
     * Locks an item's row for the rest of the transaction and reads its values as the audit
     * log keeps them: the columns its writes set, decimals as fixed-scale strings.
     *
     * @return array<string, string>
     *
     * @throws NotFound when there is no such row
     */
    private function snapshot(AuditSubjectKind $kind, int $id): array
    {
        $columns = match ($kind) {
            AuditSubjectKind::Person => 'name',
            AuditSubjectKind::Drink => 'name, points',
            AuditSubjectKind::Factor => 'name, multiplier',
            AuditSubjectKind::Entry => throw new LogicException('Entries are not catalog items'),
        };
        $row = $this->one("SELECT {$columns} FROM " . self::table($kind) . ' WHERE id = ? FOR UPDATE', $id);

        return array_map(strval(...), $row);
    }

    private static function table(AuditSubjectKind $kind): string
    {
        return match ($kind) {
            AuditSubjectKind::Person => 'persons',
            AuditSubjectKind::Drink => 'drinks',
            AuditSubjectKind::Factor => 'factors',
            AuditSubjectKind::Entry => throw new LogicException('Entries are not catalog items'),
        };
    }

    /**
     * The one row a query for an id finds.
     *
     * @return array<string, scalar|null>
     *
     * @throws NotFound when there is no such row
     */
    private function one(string $sql, int $id): array
    {
        return $this->all($sql, [$id])[0] ?? throw new NotFound((string) $id);
    }

    private function countEntries(string $column, int $id): int
    {
        $statement = $this->pdo->prepare("SELECT COUNT(*) FROM entries WHERE {$column} = ?");
        $statement->execute([$id]);

        return (int) $statement->fetchColumn();
    }

    /** A taken name as DuplicateName; any other failure as it is. */
    private static function duplicateOr(PDOException $failure, string $name): DuplicateName|PDOException
    {
        return DatabaseError::is($failure, DatabaseError::DUPLICATE_KEY) ? new DuplicateName($name, 0, $failure) : $failure;
    }

    /**
     * @param list<int|string> $parameters
     *
     * @return list<array<string, scalar|null>>
     */
    private function all(string $sql, array $parameters = []): array
    {
        $statement = $this->pdo->prepare($sql);
        $statement->execute($parameters);

        /** @var list<array<string, scalar|null>> */
        return $statement->fetchAll(PDO::FETCH_ASSOC);
    }

    /**
     * @param array<string, scalar|null> $row
     */
    private static function factorOf(array $row): Factor
    {
        return new Factor((int) $row['id'], (string) $row['name'], (string) $row['multiplier']);
    }
}
