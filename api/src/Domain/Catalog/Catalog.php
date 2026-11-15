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
        $name = trim($name);
        if (!self::validName($name)) {
            throw new ValidationFailed(['name' => self::nameError()]);
        }

        return new Person($this->insert('persons', ['name' => $name]), $name);
    }

    /**
     * @throws ValidationFailed for a name outside 1–40 characters or points outside 0–9 999.99
     * @throws DuplicateName when the name is taken, ignoring case
     */
    public function createDrink(string $name, int|float|null $points): Drink
    {
        $errors = [];
        $name = trim($name);
        if (!self::validName($name)) {
            $errors['name'] = self::nameError();
        }
        if (!self::validPoints($points)) {
            $errors['points'] = 'Zahl von 0 bis 9.999,99.';
        }
        if ($errors !== []) {
            throw new ValidationFailed($errors);
        }
        $decimal = number_format((float) $points, 2, '.', '');

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
     * @throws NotFound when there is no such factor
     */
    public function factor(int $id): Factor
    {
        $row = $this->all('SELECT id, name, multiplier FROM factors WHERE id = ?', [$id])[0] ?? null;
        if ($row === null) {
            throw new NotFound((string) $id);
        }

        return self::factorOf($row);
    }

    /** How many entries use the factor, all days: the delete dialog names them. */
    public function entriesWithFactor(int $id): int
    {
        $statement = $this->pdo->prepare('SELECT COUNT(*) FROM entries WHERE factor_id = ?');
        $statement->execute([$id]);

        return (int) $statement->fetchColumn();
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
        $now = Timestamp::of($this->clock->now());
        try {
            $this->revision->write(function () use ($id, $name, $decimal, $now): void {
                $this->lock('factors', $id);
                $this->pdo->prepare('UPDATE factors SET name = ?, multiplier = ?, updated_at = ? WHERE id = ?')
                    ->execute([$name, $decimal, $now, $id]);
            });
        } catch (PDOException $failure) {
            throw self::duplicateOr($failure, $name);
        }

        return new Factor($id, $name, $decimal);
    }

    /**
     * Deletes a factor; its entries stay and count ×1 (the foreign key sets them to no factor).
     *
     * @throws NotFound when there is no such factor
     */
    public function deleteFactor(int $id): void
    {
        $this->revision->write(function () use ($id): void {
            $statement = $this->pdo->prepare('DELETE FROM factors WHERE id = ?');
            $statement->execute([$id]);
            if ($statement->rowCount() === 0) {
                throw new NotFound((string) $id);
            }
        });
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

    /** 0 to 9 999.99 with at most two decimals. */
    private static function validPoints(int|float|null $points): bool
    {
        return $points !== null && self::validDecimal($points, self::MAX_POINTS);
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
     * Locks the row for the rest of the transaction.
     *
     * @throws NotFound when there is no such row
     */
    private function lock(string $table, int $id): void
    {
        $statement = $this->pdo->prepare("SELECT id FROM {$table} WHERE id = ? FOR UPDATE");
        $statement->execute([$id]);
        if ($statement->fetchColumn() === false) {
            throw new NotFound((string) $id);
        }
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
