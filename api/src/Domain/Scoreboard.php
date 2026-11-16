<?php

declare(strict_types=1);

namespace Performance\Domain;

use DateTimeImmutable;
use PDO;

/**
 * The read model and single owner of aggregation: for every person with entries
 * since `from`, the score (Σ quantity × multiplier × points), the count
 * (Σ quantity × multiplier) and the per-drink counters, ranked by score, ties by
 * name, with the version of the person's photo (never its bytes). The multiplier is
 * the factor's current one, 1 without a factor. Its version is the data revision:
 * while that stays, the standings for any `from` stay too.
 */
final readonly class Scoreboard
{
    public function __construct(
        private PDO $pdo,
        private DataRevision $revision,
    ) {}

    /** Changes whenever the standings may have changed, without aggregating. */
    public function revision(): int
    {
        return $this->revision->current();
    }

    /**
     * @return list<ScoreRow>
     */
    public function since(DateTimeImmutable $from): array
    {
        $since = Timestamp::of($from);
        $drinks = [];
        foreach ($this->rows(
            'SELECT e.person_id, d.id AS drink_id, d.name, SUM(e.quantity * COALESCE(f.multiplier, 1)) AS count
             FROM entries e JOIN drinks d ON d.id = e.drink_id LEFT JOIN factors f ON f.id = e.factor_id
             WHERE e.created_at >= ?
             GROUP BY e.person_id, d.id, d.name
             ORDER BY d.name, d.id',
            $since,
        ) as $row) {
            $drinks[(int) $row['person_id']][] = new DrinkCount((int) $row['drink_id'], (string) $row['name'], (string) $row['count']);
        }

        return array_map(
            static fn(array $row): ScoreRow => new ScoreRow(
                (int) $row['id'],
                (string) $row['name'],
                $row['photo_version'] === null ? null : (string) $row['photo_version'],
                (string) $row['score'],
                (string) $row['count'],
                $drinks[(int) $row['id']] ?? [],
            ),
            $this->rows(
                'SELECT p.id, p.name, ph.version AS photo_version,
                        SUM(e.quantity * COALESCE(f.multiplier, 1) * d.points) AS score,
                        SUM(e.quantity * COALESCE(f.multiplier, 1)) AS count
                 FROM entries e JOIN persons p ON p.id = e.person_id JOIN drinks d ON d.id = e.drink_id
                 LEFT JOIN factors f ON f.id = e.factor_id
                 LEFT JOIN person_photos ph ON ph.person_id = p.id
                 WHERE e.created_at >= ?
                 GROUP BY p.id, p.name, ph.version
                 ORDER BY score DESC, p.name, p.id',
                $since,
            ),
        );
    }

    /**
     * @return list<array<string, scalar|null>>
     */
    private function rows(string $sql, string $since): array
    {
        $statement = $this->pdo->prepare($sql);
        $statement->execute([$since]);

        /** @var list<array<string, scalar|null>> */
        return $statement->fetchAll(PDO::FETCH_ASSOC);
    }
}
