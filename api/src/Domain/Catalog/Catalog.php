<?php

declare(strict_types=1);

namespace Performance\Domain\Catalog;

use PDO;
use PDOException;
use Performance\Domain\Clock;
use Performance\Domain\DatabaseError;
use Performance\Domain\DataRevision;
use Performance\Domain\NotFound;
use Performance\Domain\Timestamp;
use Performance\Domain\ValidationFailed;

/**
 * Persons, drinks and factors: names trimmed, 1–40 characters and unique regardless
 * of case (the table's collation and unique key decide); drinks carry alcohol base
 * points, factors a multiplier.
 */
final readonly class Catalog
{
    public const MAX_NAME_LENGTH = 40;
    public const MAX_POINTS = 9999.99;
    public const MAX_MULTIPLIER = 99.99;

    public function __construct(
        private PDO $pdo,
        private Clock $clock,
        private DataRevision $revision,
    ) {}

    /**
     * @throws ValidationFailed for a name outside 1–40 characters
     * @throws DuplicateName when the name is taken, ignoring case
     */
    public function createPerson(string $name): Person
    {
        $name = self::validPerson($name);

        return new Person($this->insert('persons', ['name' => $name]), $name);
    }

    /**
     * @throws ValidationFailed for a name outside 1–40 characters or points outside 0–9 999.99
     * @throws DuplicateName when the name is taken, ignoring case
     */
    public function createDrink(string $name, int|float|null $points): Drink
    {
        [$name, $decimal] = self::validDrink($name, $points);

        return new Drink($this->insert('drinks', ['name' => $name, 'points' => $decimal]), $name, $decimal);
    }

    /**
     * @throws ValidationFailed for a name outside 1–40 characters or a multiplier outside (0, 99.99]
     * @throws DuplicateName when the name is taken, ignoring case
     */
    public function createFactor(string $name, int|float|null $multiplier): Factor
    {
        [$name, $decimal] = self::validFactor($name, $multiplier);

        return new Factor($this->insert('factors', ['name' => $name, 'multiplier' => $decimal]), $name, $decimal);
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
    public function updatePerson(int $id, string $name): Person
    {
        $name = self::validPerson($name);
        $this->update('persons', $id, ['name' => $name]);

        return new Person($id, $name);
    }

    /**
     * Changes a drink; its entries count with the new points from then on, every day included.
     *
     * @throws ValidationFailed like createDrink
     * @throws DuplicateName when another drink has the name, ignoring case
     * @throws NotFound when there is no such drink
     */
    public function updateDrink(int $id, string $name, int|float|null $points): Drink
    {
        [$name, $decimal] = self::validDrink($name, $points);
        $this->update('drinks', $id, ['name' => $name, 'points' => $decimal]);

        return new Drink($id, $name, $decimal);
    }

    /**
     * Changes a factor; its entries count with the new multiplier from then on, every day included.
     *
     * @throws ValidationFailed like createFactor
     * @throws DuplicateName when another factor has the name, ignoring case
     * @throws NotFound when there is no such factor
     */
    public function updateFactor(int $id, string $name, int|float|null $multiplier): Factor
    {
        [$name, $decimal] = self::validFactor($name, $multiplier);
        $this->update('factors', $id, ['name' => $name, 'multiplier' => $decimal]);

        return new Factor($id, $name, $decimal);
    }

    /**
     * Deletes a person and all of the person's entries (the foreign key cascades).
     *
     * @throws NotFound when there is no such person
     */
    public function deletePerson(int $id): void
    {
        $this->delete('persons', $id);
    }

    /**
     * Deletes a drink and all of its entries (the foreign key cascades).
     *
     * @throws NotFound when there is no such drink
     */
    public function deleteDrink(int $id): void
    {
        $this->delete('drinks', $id);
    }

    /**
     * Deletes a factor; its entries stay and count ×1 (the foreign key sets them to no factor).
     *
     * @throws NotFound when there is no such factor
     */
    public function deleteFactor(int $id): void
    {
        $this->delete('factors', $id);
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
     * @param array<string, string> $columns
     *
     * @return int the new row's id
     */
    private function insert(string $table, array $columns): int
    {
        $now = Timestamp::of($this->clock->now());
        $names = [...array_keys($columns), 'created_at', 'updated_at'];
        $sql = sprintf(
            'INSERT INTO %s (%s) VALUES (%s)',
            $table,
            implode(', ', $names),
            implode(', ', array_fill(0, count($names), '?')),
        );
        try {
            return $this->revision->write(function () use ($sql, $columns, $now): int {
                $this->pdo->prepare($sql)->execute([...array_values($columns), $now, $now]);

                return (int) $this->pdo->lastInsertId();
            });
        } catch (PDOException $failure) {
            throw self::duplicateOr($failure, $columns['name'] ?? '');
        }
    }

    /**
     * Changes a row's columns together with the revision bump.
     *
     * @param array<string, string> $columns
     *
     * @throws NotFound when there is no such row
     * @throws DuplicateName when the new name is taken, ignoring case
     */
    private function update(string $table, int $id, array $columns): void
    {
        $now = Timestamp::of($this->clock->now());
        $assignments = implode(', ', array_map(static fn(string $column): string => "{$column} = ?", array_keys($columns)));
        try {
            $this->revision->write(function () use ($table, $id, $columns, $assignments, $now): void {
                // Locked first, so an unchanged row (same values) is still told apart from a missing one.
                $this->one("SELECT id FROM {$table} WHERE id = ? FOR UPDATE", $id);
                $this->pdo->prepare("UPDATE {$table} SET {$assignments}, updated_at = ? WHERE id = ?")
                    ->execute([...array_values($columns), $now, $id]);
            });
        } catch (PDOException $failure) {
            throw self::duplicateOr($failure, $columns['name'] ?? '');
        }
    }

    /**
     * Deletes a row together with the revision bump; foreign keys decide what happens to its entries.
     *
     * @throws NotFound when there is no such row
     */
    private function delete(string $table, int $id): void
    {
        $this->revision->write(function () use ($table, $id): void {
            $statement = $this->pdo->prepare("DELETE FROM {$table} WHERE id = ?");
            $statement->execute([$id]);
            if ($statement->rowCount() === 0) {
                throw new NotFound((string) $id);
            }
        });
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
