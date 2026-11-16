<?php

declare(strict_types=1);

namespace Performance\Domain\Games;

use DateTimeImmutable;
use DateTimeZone;
use PDO;
use PDOException;
use Performance\Domain\Actor;
use Performance\Domain\AuditLog;
use Performance\Domain\AuditOperation;
use Performance\Domain\AuditSubjectKind;
use Performance\Domain\Catalog\Catalog;
use Performance\Domain\Catalog\DuplicateName;
use Performance\Domain\Clock;
use Performance\Domain\DatabaseError;
use Performance\Domain\DataRevision;
use Performance\Domain\GameDependents;
use Performance\Domain\NotFound;
use Performance\Domain\Timestamp;
use Performance\Domain\ValidationFailed;

/**
 * The games: create, list, read, edit, restart and delete. Names follow the catalog's rules
 * (trimmed, 1–40 characters, unique ignoring case); the kind is set once, its setting can
 * change. Every write locks the game row first (`FOR UPDATE`), names its actor and is recorded
 * in the audit log in its own transaction, together with the data revision bump.
 *
 * The game's matches and results belong to other modules; Games reaches them only through
 * GameDependents.
 */
final readonly class Games
{
    private const COLUMNS = 'id, name, kind, draws_allowed, lower_wins, run, started_at';
    private const KIND_ERROR = 'Duell oder Punktespiel.';

    public function __construct(
        private PDO $pdo,
        private Clock $clock,
        private DataRevision $revision,
        private AuditLog $audit,
        private GameDependents $dependents,
    ) {}

    /**
     * Creates a game in its first run, starting now. Only the kind's own setting is taken: a
     * duel game's draws are allowed unless `$drawsAllowed` is false, a points game's highest
     * sum wins unless `$lowerWins` is true.
     *
     * @param string|null $kind `duel` or `points`
     *
     * @throws ValidationFailed for a name outside 1–40 characters or an unknown kind
     * @throws DuplicateName when another game has the name, ignoring case
     */
    public function create(Actor $actor, string $name, ?string $kind, ?bool $drawsAllowed, ?bool $lowerWins): Game
    {
        $name = trim($name);
        $nameErrors = Catalog::validName($name) ? [] : ['name' => Catalog::nameError()];
        $gameKind = GameKind::tryFrom($kind ?? '') ?? throw new ValidationFailed([...$nameErrors, 'kind' => self::KIND_ERROR]);
        if ($nameErrors !== []) {
            throw new ValidationFailed($nameErrors);
        }
        $now = $this->now();
        [$drawsAllowed, $lowerWins] = self::setting($gameKind, true, false, $drawsAllowed, $lowerWins);

        try {
            return $this->revision->write(function () use ($actor, $name, $gameKind, $drawsAllowed, $lowerWins, $now): Game {
                $this->pdo->prepare(
                    'INSERT INTO games (name, kind, draws_allowed, lower_wins, run, started_at, created_at) VALUES (?, ?, ?, ?, 1, ?, ?)',
                )->execute([$name, $gameKind->value, (int) $drawsAllowed, (int) $lowerWins, Timestamp::of($now), Timestamp::of($now)]);
                $game = new Game((int) $this->pdo->lastInsertId(), $name, $gameKind, $drawsAllowed, $lowerWins, 1, $now);
                $this->audit->record($actor, AuditOperation::Create, AuditSubjectKind::Game, (string) $game->id, null, $game->snapshot());

                return $game;
            });
        } catch (PDOException $failure) {
            throw self::duplicateOr($failure, $name);
        }
    }

    /**
     * @return list<Game> alphabetical, ignoring case
     */
    public function all(): array
    {
        $statement = $this->pdo->query('SELECT ' . self::COLUMNS . ' FROM games ORDER BY name, id');
        if ($statement === false) {
            return [];
        }

        /** @var list<array<string, scalar|null>> $rows */
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC);

        return array_map(self::gameOf(...), $rows);
    }

    /**
     * @throws NotFound when there is no such game
     */
    public function game(int $id): Game
    {
        return $this->find($id, '');
    }

    /** How many matches or results of every run belong to the game: deleting the game deletes them. */
    public function dependentCount(int $id): int
    {
        return $this->dependents->count($id);
    }

    /**
     * Renames a game and, where given, changes its kind's setting; the ranking follows it at
     * once. The kind is fixed: naming another one is refused.
     *
     * @param string|null $kind the game's own kind, or null
     *
     * @throws ValidationFailed for a name outside 1–40 characters or another kind
     * @throws DuplicateName when another game has the name, ignoring case
     * @throws NotFound when there is no such game
     */
    public function update(Actor $actor, int $id, string $name, ?string $kind, ?bool $drawsAllowed, ?bool $lowerWins): Game
    {
        $name = trim($name);
        if (!Catalog::validName($name)) {
            throw new ValidationFailed(['name' => Catalog::nameError()]);
        }

        return $this->change($actor, $id, static function (Game $game) use ($name, $kind, $drawsAllowed, $lowerWins): Game {
            if ($kind !== null && $kind !== $game->kind->value) {
                throw new ValidationFailed(['kind' => 'Die Art eines Spiels ist fest.']);
            }
            [$draws, $lower] = self::setting($game->kind, $game->drawsAllowed, $game->lowerWins, $drawsAllowed, $lowerWins);

            return new Game($game->id, $name, $game->kind, $draws, $lower, $game->run, $game->startedAt);
        });
    }

    /**
     * Starts the game's next run from now: its ranking begins anew, older results stay stored.
     * Recording holds the game row under a shared lock while it copies the run, so a recording
     * either committed before the restart (old run) or waits for it (new run).
     *
     * @throws NotFound when there is no such game
     */
    public function restart(Actor $actor, int $id): Game
    {
        $now = $this->now();

        return $this->change(
            $actor,
            $id,
            static fn(Game $game): Game => new Game($game->id, $game->name, $game->kind, $game->drawsAllowed, $game->lowerWins, $game->run + 1, $now),
        );
    }

    /**
     * Deletes a game with its matches or results of every run. Lock order: the game row for
     * update first, then its dependents' rows. The game's deletion is recorded before its
     * dependents record the removal of their rows as its consequences; only then is the game
     * deleted, and the foreign keys delete those rows. All in one transaction.
     *
     * @throws NotFound when there is no such game
     */
    public function delete(Actor $actor, int $id): void
    {
        $this->revision->write(function () use ($actor, $id): void {
            $game = $this->find($id, ' FOR UPDATE');
            $cause = (int) $this->audit->record($actor, AuditOperation::Delete, AuditSubjectKind::Game, (string) $id, $game->snapshot(), null);
            $this->dependents->recordRemoval($actor, $id, $cause);
            $this->pdo->prepare('DELETE FROM games WHERE id = ?')->execute([$id]);
        });
    }

    /**
     * Locks a game row, changes it as `$change` says, stores and records the change, all in one
     * transaction with the revision bump. An edit that changes nothing records nothing.
     *
     * @param callable(Game): Game $change
     *
     * @throws NotFound when there is no such game
     * @throws DuplicateName when the changed name is another game's, ignoring case
     */
    private function change(Actor $actor, int $id, callable $change): Game
    {
        return $this->revision->write(function () use ($actor, $id, $change): Game {
            $before = $this->find($id, ' FOR UPDATE');
            $after = $change($before);
            try {
                $this->pdo->prepare('UPDATE games SET name = ?, draws_allowed = ?, lower_wins = ?, run = ?, started_at = ? WHERE id = ?')
                    ->execute([$after->name, (int) $after->drawsAllowed, (int) $after->lowerWins, $after->run, Timestamp::of($after->startedAt), $id]);
            } catch (PDOException $failure) {
                throw self::duplicateOr($failure, $after->name);
            }
            $this->audit->record($actor, AuditOperation::Update, AuditSubjectKind::Game, (string) $id, $before->snapshot(), $after->snapshot());

            return $after;
        });
    }

    /**
     * @param string $lock `''`, or ` FOR UPDATE` inside a write
     *
     * @throws NotFound when there is no such game
     */
    private function find(int $id, string $lock): Game
    {
        $statement = $this->pdo->prepare('SELECT ' . self::COLUMNS . " FROM games WHERE id = ?{$lock}");
        $statement->execute([$id]);
        /** @var array<string, scalar|null>|false $row */
        $row = $statement->fetch(PDO::FETCH_ASSOC);

        return $row === false ? throw new NotFound((string) $id) : self::gameOf($row);
    }

    /**
     * A game's two settings after a write: its kind's changed where one is given, the other
     * kind's as it was.
     *
     * @return array{bool, bool} drawsAllowed and lowerWins
     */
    private static function setting(GameKind $kind, bool $drawsAllowed, bool $lowerWins, ?bool $newDrawsAllowed, ?bool $newLowerWins): array
    {
        return match ($kind) {
            GameKind::Duel => [$newDrawsAllowed ?? $drawsAllowed, $lowerWins],
            GameKind::Points => [$drawsAllowed, $newLowerWins ?? $lowerWins],
        };
    }

    /** Now, as precisely as the database stores it, so a returned game equals the stored one. */
    private function now(): DateTimeImmutable
    {
        return new DateTimeImmutable(Timestamp::of($this->clock->now()), new DateTimeZone('UTC'));
    }

    /**
     * @param array<string, scalar|null> $row
     */
    private static function gameOf(array $row): Game
    {
        return new Game(
            (int) $row['id'],
            (string) $row['name'],
            GameKind::from((string) $row['kind']),
            (bool) $row['draws_allowed'],
            (bool) $row['lower_wins'],
            (int) $row['run'],
            new DateTimeImmutable((string) $row['started_at'], new DateTimeZone('UTC')),
        );
    }

    /** A taken name as DuplicateName; any other failure as it is. */
    private static function duplicateOr(PDOException $failure, string $name): DuplicateName|PDOException
    {
        return DatabaseError::is($failure, DatabaseError::DUPLICATE_KEY) ? new DuplicateName($name, 0, $failure) : $failure;
    }
}
