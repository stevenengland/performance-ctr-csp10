<?php

declare(strict_types=1);

namespace Performance\Domain;

use DateTimeImmutable;
use PDO;

/**
 * The days-with-data reads (PRD #70): the 15-minute UTC buckets that hold at least one row that
 * counts, by the row's recording instant, as sessions: spans `[from, to)`, ascending, from the
 * start of a session's first bucket to the end of its last, where a pause shorter than
 * PAUSE_QUARTERS quarter hours (6 hours) without rows does not end a session. Every UTC offset
 * in use is a multiple of 15 minutes, so a client finds its local days in them exactly: a span
 * touches every local day its buckets touch and no more, as no local day (23 hours at the
 * least) fits into a pause shorter than 6 hours. No time zone reaches the server, and the
 * answer grows with the evenings that have rows, never with the rows or their quarter hours.
 *
 * A bucket is the number of whole minutes from 1970-01-01 00:00 to the stored UTC `DATETIME`,
 * divided by 15: calendar arithmetic on the stored value, which no session time zone touches
 * (unlike `UNIX_TIMESTAMP()`). A bucket at least PAUSE_QUARTERS + 1 after the one before it
 * starts a session; the running count of those starts numbers the sessions.
 */
final class QuarterHours
{
    private const SECONDS = 900;
    /** A pause of 24 quarter hours (6 hours) or more without rows ends a session. */
    private const PAUSE_QUARTERS = 24;

    /**
     * @param string           $rows       the `FROM` clause of the rows, as their ranking joins them
     * @param string           $column     their recording instant
     * @param string           $condition  which of them count, without `WHERE`; the interval's condition
     *                                     on `$column` lets it seek by time
     * @param list<int|string> $parameters the placeholders' values, in order
     *
     * @return list<Span>
     */
    public static function spans(PDO $pdo, string $rows, string $column, string $condition, array $parameters = []): array
    {
        $statement = $pdo->prepare(
            'SELECT MIN(quarter_hour) AS first, MAX(quarter_hour) AS last
             FROM (
                 SELECT quarter_hour, SUM(starts) OVER (ORDER BY quarter_hour) AS session
                 FROM (
                     SELECT quarter_hour, COALESCE(quarter_hour - LAG(quarter_hour) OVER (ORDER BY quarter_hour) > ' . self::PAUSE_QUARTERS . ", TRUE) AS starts
                     FROM (
                         SELECT DISTINCT TIMESTAMPDIFF(MINUTE, '1970-01-01 00:00:00', {$column}) DIV 15 AS quarter_hour
                         FROM {$rows} WHERE {$condition}
                     ) quarters
                 ) marked
             ) numbered
             GROUP BY session ORDER BY first",
        );
        $statement->execute($parameters);
        /** @var list<array{first: int|string, last: int|string}> $runs */
        $runs = $statement->fetchAll(PDO::FETCH_ASSOC);

        return array_map(
            static fn(array $run): Span => new Span(self::start((int) $run['first']), self::start((int) $run['last'] + 1)),
            $runs,
        );
    }

    private static function start(int $quarterHour): DateTimeImmutable
    {
        return new DateTimeImmutable('@' . ($quarterHour * self::SECONDS));
    }
}
