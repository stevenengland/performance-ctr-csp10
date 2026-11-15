<?php

declare(strict_types=1);

namespace Performance\Domain\Catalog;

use PDO;
use PDOException;
use Performance\Domain\Clock;
use Performance\Domain\DatabaseError;
use Performance\Domain\Timestamp;
use Performance\Domain\ValidationFailed;

/**
 * Persons and drinks: names trimmed, 1–40 characters and unique regardless of case
 * (the table's collation and unique key decide); drinks carry alcohol base points.
 */
final readonly class Catalog
{
    public const MAX_NAME_LENGTH = 40;
    public const MAX_POINTS = 9999.99;

    public function __construct(
        private PDO $pdo,
        private Clock $clock,
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
        if ($points === null || $points < 0 || $points > self::MAX_POINTS) {
            return false;
        }
        $hundredths = $points * 100;

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
            $this->pdo->prepare($sql)->execute([...array_values($columns), $now, $now]);
        } catch (PDOException $failure) {
            if (DatabaseError::is($failure, DatabaseError::DUPLICATE_KEY)) {
                throw new DuplicateName($columns['name'] ?? '', 0, $failure);
            }
            throw $failure;
        }

        return (int) $this->pdo->lastInsertId();
    }

    /**
     * @return list<array<string, scalar|null>>
     */
    private function all(string $sql): array
    {
        $statement = $this->pdo->query($sql);

        /** @var list<array<string, scalar|null>> */
        return $statement === false ? [] : $statement->fetchAll(PDO::FETCH_ASSOC);
    }
}
