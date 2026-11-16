<?php

declare(strict_types=1);

namespace Performance\Domain\Games;

use DateTimeImmutable;
use DateTimeZone;
use PDO;
use Performance\Domain\NotFound;
use Performance\Domain\Timestamp;
use Performance\Domain\ValidationFailed;

/**
 * Pages a game's Verlauf: the rows of one run, newest first by `(created_at, id)`, with the
 * same pair as the keyset predicate, so rows of one millisecond are neither repeated nor
 * skipped and rows recorded meanwhile never shift an older page. The first page reads the
 * game's current run; later pages read the run their cursor names, so a restart between two
 * requests never mixes runs. Matches and Results each bring the query for their own rows.
 */
final readonly class GameHistory
{
    /** Rows per page when the reader names no limit. */
    public const PAGE_SIZE = 20;
    public const MAX_PAGE_SIZE = 100;

    public function __construct(private PDO $pdo) {}

    /**
     * @template T of MatchItem|ResultItem
     *
     * @param GameKind                                $kind   the kind whose rows `$select` reads
     * @param string                                  $select the rows' SELECT, its table aliased `h` and read through
     *                                                        its `(game_id, run, created_at, id)` index, naming
     *                                                        `h.id` and `h.created_at`; no WHERE
     * @param string|null                             $before the `next` of the previous page; null for the newest page
     * @param callable(array<string, scalar|null>): T $item   one row as an item
     *
     * @return HistoryPage<T>
     *
     * @throws NotFound         when the game is of another kind
     * @throws ValidationFailed when `$before` names no cursor or `$limit` is out of range
     */
    public function page(Game $game, GameKind $kind, string $select, ?string $before, int $limit, callable $item): HistoryPage
    {
        if ($game->kind !== $kind) {
            throw new NotFound((string) $game->id);
        }
        $cursor = $before === null ? null : HistoryCursor::of($before);
        $errors = array_filter([
            'before' => $before !== null && $cursor === null ? 'Unbekannte Seite.' : null,
            'limit' => $limit < 1 || $limit > self::MAX_PAGE_SIZE ? sprintf('1 bis %d.', self::MAX_PAGE_SIZE) : null,
        ]);
        if ($errors !== []) {
            throw new ValidationFailed($errors);
        }
        $run = $cursor === null ? $game->run : $cursor->run;
        $statement = $this->pdo->prepare(
            $select . ' WHERE h.game_id = ? AND h.run = ?'
            . ($cursor === null ? '' : ' AND (h.created_at < ? OR (h.created_at = ? AND h.id < ?))')
            . ' ORDER BY h.created_at DESC, h.id DESC LIMIT ' . ($limit + 1),
        );
        $keyset = $cursor === null ? [] : [Timestamp::of($cursor->createdAt), Timestamp::of($cursor->createdAt), $cursor->id];
        $statement->execute([$game->id, $run, ...$keyset]);
        /** @var list<array<string, scalar|null>> $rows */
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC);
        $shown = array_slice($rows, 0, $limit);
        $oldest = end($shown);

        return new HistoryPage(
            array_map($item, $shown),
            count($rows) > $limit && $oldest !== false
                ? (new HistoryCursor($run, self::instant($oldest['created_at']), (string) $oldest['id']))->token()
                : null,
        );
    }

    /** A row's `DATETIME(3)` value as the UTC instant it is. */
    public static function instant(bool|float|int|string|null $value): DateTimeImmutable
    {
        return new DateTimeImmutable((string) $value, new DateTimeZone('UTC'));
    }
}
