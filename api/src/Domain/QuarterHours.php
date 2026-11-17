<?php

declare(strict_types=1);

namespace Performance\Domain;

use DateTimeImmutable;
use PDO;

/**
 * The days-with-data reads (PRD #70): the start instants, ascending, of the distinct 15-minute
 * UTC buckets that hold at least one row that counts, by the row's recording instant. Every UTC
 * offset in use is a multiple of 15 minutes, so a client buckets them into its local days
 * exactly, and no time zone reaches the server.
 *
 * A bucket is the number of whole minutes from 1970-01-01 00:00 to the stored UTC `DATETIME`,
 * divided by 15: calendar arithmetic on the stored value, which no session time zone touches
 * (unlike `UNIX_TIMESTAMP()`). The answer grows with the quarter hours that have rows, at most
 * 96 a day, never with the rows.
 */
final class QuarterHours
{
    private const SECONDS = 900;

    /**
     * @param string           $rows       the `FROM` clause of the rows, as their ranking joins them
     * @param string           $column     their recording instant
     * @param string           $condition  which of them count, without `WHERE`
     * @param list<int|string> $parameters the placeholders' values, in order
     *
     * @return list<DateTimeImmutable>
     */
    public static function of(PDO $pdo, string $rows, string $column, string $condition, array $parameters = []): array
    {
        $statement = $pdo->prepare(
            "SELECT DISTINCT TIMESTAMPDIFF(MINUTE, '1970-01-01 00:00:00', {$column}) DIV 15 AS quarter_hour
             FROM {$rows} WHERE {$condition} ORDER BY quarter_hour",
        );
        $statement->execute($parameters);
        /** @var list<int|string> $buckets */
        $buckets = $statement->fetchAll(PDO::FETCH_COLUMN);

        return array_map(
            static fn(int|string $bucket): DateTimeImmutable => new DateTimeImmutable('@' . ((int) $bucket * self::SECONDS)),
            $buckets,
        );
    }
}
