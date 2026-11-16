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
use Performance\Domain\DeletionLock;
use Performance\Domain\DataRevision;
use Performance\Domain\EntrySnapshots;
use Performance\Domain\NotFound;
use Performance\Domain\PersonDependentCounts;
use Performance\Domain\PersonDependents;
use Performance\Domain\Timestamp;
use Performance\Domain\ValidationFailed;

/**
 * Persons, drinks and factors: names trimmed, 1–40 characters and unique regardless
 * of case (the table's collation and unique key decide); drinks carry alcohol base
 * points, factors a multiplier. Every write names its actor and is recorded in the audit
 * log in its own transaction, with the item's values before and after. What a person's
 * deletion does to other modules' rows (matches, results) it asks through PersonDependents.
 */
final readonly class Catalog
{
    public const MAX_NAME_LENGTH = 40;
    public const MAX_POINTS = 9999.99;
    public const MAX_MULTIPLIER = 99.99;

    /** Persons with their photo's version, never its bytes (null without a photo). */
    private const PERSONS = 'SELECT p.id, p.name, ph.version FROM persons p LEFT JOIN person_photos ph ON ph.person_id = p.id';

    public function __construct(
        private PDO $pdo,
        private Clock $clock,
        private DataRevision $revision,
        private AuditLog $audit,
        private PersonDependents $personDependents,
    ) {}

    /**
     * @throws ValidationFailed for a name outside 1–40 characters
     * @throws DuplicateName when the name is taken, ignoring case
     */
    public function createPerson(Actor $actor, string $name): Person
    {
        $name = self::validPerson($name);

        // A new person has no photo yet; the snapshot says so, like every person event's.
        return new Person($this->insert($actor, AuditSubjectKind::Person, ['name' => $name], ['name' => $name, 'photo' => null]), $name, null);
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
        return array_map(self::personOf(...), $this->all(self::PERSONS . ' ORDER BY p.name, p.id'));
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
        return self::personOf($this->one(self::PERSONS . ' WHERE p.id = ?', $id));
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

    /** The other modules' rows that name the person: deleting the person keeps the matches. */
    public function dependentsOfPerson(int $id): PersonDependentCounts
    {
        return $this->personDependents->countOfPerson($id);
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
        $after = $this->update($actor, AuditSubjectKind::Person, $id, ['name' => $name]);

        return new Person($id, $name, $after['photo'] ?? null);
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
     * Deletes a person and all of the person's entries and results (the foreign keys
     * cascade); the person's matches stay with that side cleared (the foreign key sets it to
     * null). Each of those changes is recorded as caused by the person's deletion.
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

    /** Whether a trimmed name is 1–40 characters: the rule for every name in the catalog, and for games. */
    public static function validName(string $name): bool
    {
        $length = mb_strlen($name, 'UTF-8');

        return $length >= 1 && $length <= self::MAX_NAME_LENGTH;
    }

    /** What a name breaking `validName` is told. */
    public static function nameError(): string
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
     * @param array<string, string>           $columns  the item's values
     * @param array<string, string|null>|null $snapshot what the audit log records; the columns when null
     *
     * @return int the new row's id
     */
    private function insert(Actor $actor, AuditSubjectKind $kind, array $columns, ?array $snapshot = null): int
    {
        $snapshot ??= $columns;
        $now = Timestamp::of($this->clock->now());
        $names = [...array_keys($columns), 'created_at', 'updated_at'];
        $sql = sprintf(
            'INSERT INTO %s (%s) VALUES (%s)',
            self::table($kind),
            implode(', ', $names),
            implode(', ', array_fill(0, count($names), '?')),
        );
        try {
            return $this->revision->write(function () use ($actor, $kind, $sql, $columns, $snapshot, $now): int {
                $this->pdo->prepare($sql)->execute([...array_values($columns), $now, $now]);
                $id = (int) $this->pdo->lastInsertId();
                $this->audit->record($actor, AuditOperation::Create, $kind, (string) $id, null, $snapshot);

                return $id;
            });
        } catch (PDOException $failure) {
            throw self::duplicateOr($failure, $columns['name'] ?? '');
        }
    }

    /**
     * Changes a row's columns, records the change and bumps the revision, all in one transaction.
     * The snapshot after is the one before with the new values, so what the change leaves alone
     * (a person's photo) is recorded unchanged.
     *
     * @param array<string, string> $columns the item's new values
     *
     * @return array<string, string|null> the snapshot after, as the audit log records it
     *
     * @throws NotFound when there is no such row
     * @throws DuplicateName when the new name is taken, ignoring case
     */
    private function update(Actor $actor, AuditSubjectKind $kind, int $id, array $columns): array
    {
        $now = Timestamp::of($this->clock->now());
        $table = self::table($kind);
        $assignments = implode(', ', array_map(static fn(string $column): string => "{$column} = ?", array_keys($columns)));
        try {
            return $this->revision->write(function () use ($actor, $kind, $table, $id, $columns, $assignments, $now): array {
                // Locked first, so the values before are the ones this change replaces, and an
                // unchanged row (same values) is still told apart from a missing one.
                $before = $this->snapshot($kind, $id);
                $this->pdo->prepare("UPDATE {$table} SET {$assignments}, updated_at = ? WHERE id = ?")
                    ->execute([...array_values($columns), $now, $id]);
                $after = [...$before, ...$columns];
                $this->audit->record($actor, AuditOperation::Update, $kind, (string) $id, $before, $after);

                return $after;
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
     * A person's deletion then has its PersonDependents lock, read and record their rows,
     * after its own event and its entries'; a match recording waits and fails just the same.
     *
     * The DeletionLock lets one deletion run at a time, game deletions included. Without it, two
     * deletions of different rows that share an entry (its person and its drink, say) would
     * each lock their row and then wait for the other's: one locks the entry, the other its own
     * row, and each needs what the other holds to snapshot the entry.
     *
     * @throws NotFound when there is no such row
     */
    private function delete(Actor $actor, AuditSubjectKind $kind, int $id): void
    {
        DeletionLock::hold($this->pdo, function () use ($actor, $kind, $id): void {
            $this->revision->write(function () use ($actor, $kind, $id): void {
                $before = $this->snapshot($kind, $id);
                $entryIds = EntrySnapshots::lockReferencing($this->pdo, $kind, $id);
                // A factor's entries stay and lose it; a person's or a drink's go with it.
                $clearsFactor = $kind === AuditSubjectKind::Factor;
                $cause = $this->audit->recordDeletion(
                    $actor,
                    $kind,
                    (string) $id,
                    $before,
                    $clearsFactor ? AuditOperation::Update : AuditOperation::Delete,
                    $this->entryChanges($entryIds, $clearsFactor),
                );
                if ($kind === AuditSubjectKind::Person) {
                    $this->personDependents->recordPersonDeletion($actor, $id, $cause);
                }
                $this->pdo->prepare('DELETE FROM ' . self::table($kind) . ' WHERE id = ?')->execute([$id]);
            });
        });
    }

    /**
     * What a deletion does to each of its entries, read as the audit log stores it, chunk by chunk.
     *
     * @param list<string> $entryIds locked by this transaction
     *
     * @return iterable<array{string, array<string, mixed>, array<string, mixed>|null}> each entry's id and its values before and after
     */
    private function entryChanges(array $entryIds, bool $clearsFactor): iterable
    {
        foreach (EntrySnapshots::each($this->pdo, $entryIds) as $entryId => $entry) {
            yield [$entryId, $entry, $clearsFactor ? [...$entry, 'factor' => null] : null];
        }
    }

    /**
     * Locks an item's row for the rest of the transaction and reads its values as the audit
     * log keeps them: the columns its writes set, decimals as fixed-scale strings. A person is
     * `{name, photo}`, locked person first, then photo (PersonPhotos::lockedPerson).
     *
     * @return array<string, string|null>
     *
     * @throws NotFound when there is no such row
     */
    private function snapshot(AuditSubjectKind $kind, int $id): array
    {
        if ($kind === AuditSubjectKind::Person) {
            return PersonPhotos::lockedPerson($this->pdo, $id);
        }
        $columns = match ($kind) {
            AuditSubjectKind::Drink => 'name, points',
            AuditSubjectKind::Factor => 'name, multiplier',
            AuditSubjectKind::Entry, AuditSubjectKind::Game, AuditSubjectKind::Match, AuditSubjectKind::Result => throw new LogicException("{$kind->value} is not a catalog item"),
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
            AuditSubjectKind::Entry, AuditSubjectKind::Game, AuditSubjectKind::Match, AuditSubjectKind::Result => throw new LogicException("{$kind->value} is not a catalog item"),
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
     * @param array<string, scalar|null> $row a row of PERSONS
     */
    private static function personOf(array $row): Person
    {
        return new Person((int) $row['id'], (string) $row['name'], $row['version'] === null ? null : (string) $row['version']);
    }

    /**
     * @param array<string, scalar|null> $row
     */
    private static function factorOf(array $row): Factor
    {
        return new Factor((int) $row['id'], (string) $row['name'], (string) $row['multiplier']);
    }
}
