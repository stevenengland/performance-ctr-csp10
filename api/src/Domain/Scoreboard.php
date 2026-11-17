<?php

declare(strict_types=1);

namespace Performance\Domain;

use PDO;

/**
 * The read model and single owner of aggregation: for every person with entries in an Interval,
 * the score (Σ quantity × multiplier × points), the count (Σ quantity × multiplier) and the
 * per-drink counters, ranked by score, ties by name, with the version of the person's photo
 * (never its bytes). The multiplier is the factor's current one, 1 without a factor.
 *
 * Only verified entries count (PRD #61): score, count and each drink's `count` leave pending
 * entries out. Each drink's `recordedCount` counts every recorded entry, which the recording
 * flow shows, and each person names the number of their pending entries. A person whose
 * entries all wait has no rank: they are listed apart, unranked.
 *
 * Its version is the data revision: while that stays, the standings for any interval stay too.
 */
final readonly class Scoreboard
{
    private const COUNTED = 'e.quantity * COALESCE(f.multiplier, 1)';

    public function __construct(
        private PDO $pdo,
        private DataRevision $revision,
    ) {}

    /** Changes whenever the standings may have changed, without aggregating. */
    public function revision(): int
    {
        return $this->revision->current();
    }

    public function in(Interval $interval): DrinkStandings
    {
        $drinks = $this->drinkCounts($interval);
        $rows = [];
        $unranked = [];
        foreach ($this->persons($interval) as $row) {
            $id = (int) $row['id'];
            $photoVersion = $row['photo_version'] === null ? null : (string) $row['photo_version'];
            if ((int) $row['verified_entries'] === 0) {
                $unranked[] = new UnrankedRow($id, (string) $row['name'], $photoVersion, (int) $row['pending_entries'], $drinks[$id] ?? []);
            } else {
                $rows[] = new ScoreRow($id, (string) $row['name'], $photoVersion, (string) $row['score'], (string) $row['count'], (int) $row['pending_entries'], $drinks[$id] ?? []);
            }
        }

        return new DrinkStandings($rows, $unranked);
    }

    /**
     * Every person with entries in the interval: ranked ones first, by score, ties by name; then
     * those without a verified entry, by name.
     *
     * @return list<array<string, scalar|null>>
     */
    private function persons(Interval $interval): array
    {
        return $this->rows(
            'SELECT p.id, p.name, ph.version AS photo_version,
                    SUM(IF(e.pending = 0, ' . self::COUNTED . ' * d.points, 0)) AS score,
                    SUM(IF(e.pending = 0, ' . self::COUNTED . ', 0)) AS count,
                    SUM(e.pending = 0) AS verified_entries,
                    SUM(e.pending = 1) AS pending_entries
             FROM entries e JOIN persons p ON p.id = e.person_id JOIN drinks d ON d.id = e.drink_id
             LEFT JOIN factors f ON f.id = e.factor_id
             LEFT JOIN person_photos ph ON ph.person_id = p.id
             WHERE ' . $interval->condition('e.created_at') . '
             GROUP BY p.id, p.name, ph.version
             ORDER BY SUM(e.pending = 0) = 0, score DESC, p.name, p.id',
            $interval,
        );
    }

    /**
     * Each person's drinks in the interval with their verified and recorded counters, by name.
     *
     * @return array<int, list<DrinkCount>> by person id
     */
    private function drinkCounts(Interval $interval): array
    {
        $drinks = [];
        foreach ($this->rows(
            'SELECT e.person_id, d.id AS drink_id, d.name,
                    SUM(IF(e.pending = 0, ' . self::COUNTED . ', 0)) AS count,
                    SUM(' . self::COUNTED . ') AS recorded_count
             FROM entries e JOIN drinks d ON d.id = e.drink_id LEFT JOIN factors f ON f.id = e.factor_id
             WHERE ' . $interval->condition('e.created_at') . '
             GROUP BY e.person_id, d.id, d.name
             ORDER BY d.name, d.id',
            $interval,
        ) as $row) {
            $drinks[(int) $row['person_id']][] = new DrinkCount((int) $row['drink_id'], (string) $row['name'], (string) $row['count'], (string) $row['recorded_count']);
        }

        return $drinks;
    }

    /**
     * @return list<array<string, scalar|null>>
     */
    private function rows(string $sql, Interval $interval): array
    {
        $statement = $this->pdo->prepare($sql);
        $statement->execute($interval->parameters());

        /** @var list<array<string, scalar|null>> */
        return $statement->fetchAll(PDO::FETCH_ASSOC);
    }
}
