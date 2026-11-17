<?php

declare(strict_types=1);

namespace Performance\Http;

use Performance\Domain\Games\CurrentRun;
use Performance\Domain\Games\DuelRow;
use Performance\Domain\Games\Game;
use Performance\Domain\Games\GameKind;
use Performance\Domain\Games\PointsRow;
use Performance\Domain\Games\Standings;
use Performance\Domain\Games\UnrankedPlayer;
use Performance\Domain\Interval;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;

/**
 * `GET /api/games/{id}/standings`: the game's ranking in its current run, or with
 * `from=<instant>[&to=<instant>]` or `scope=all` over every match or result recorded in that
 * interval, whatever its run; tagged with its kind. The query is normalised into one selection
 * before anything is read. The game, the data revision and the ranking are read in one
 * snapshot, so the ETag (the revision, and the interval when there is one) always names what
 * is sent, and `If-None-Match` with an unchanged tag answers 304 before anything is ranked.
 */
final readonly class StandingsAction
{
    public function __construct(private Database $database) {}

    /**
     * @param array{id: string} $arguments
     */
    public function __invoke(ServerRequestInterface $request, ResponseInterface $response, array $arguments): ResponseInterface
    {
        $database = $this->database;
        $selection = IntervalQuery::windowAllTimeOrCurrentRun($request);

        return $database->snapshot()->read(static function () use ($database, $selection, $request, $response, $arguments): ResponseInterface {
            $game = $database->games()->game((int) $arguments['id']);

            return ConditionalGet::respond(
                $request,
                $response,
                self::tag($database->revision()->current(), $selection),
                static fn(ResponseInterface $response): ResponseInterface => Json::write($response, self::standings($database, $game, $selection)),
            );
        });
    }

    /** The current run's tag is the bare revision, as before; an interval adds its own part. */
    private static function tag(int $revision, Interval|CurrentRun $selection): string
    {
        return $selection instanceof Interval
            ? sprintf('"%d-%s"', $revision, IntervalQuery::tag($selection))
            : sprintf('"%d"', $revision);
    }

    /**
     * @return array<string, mixed>
     */
    private static function standings(Database $database, Game $game, Interval|CurrentRun $selection): array
    {
        return match ($game->kind) {
            GameKind::Duel => self::duel($game, $database->matches()->standings($game, $selection)),
            GameKind::Points => self::points($game, $database->results()->standings($game, $selection)),
        };
    }

    /**
     * The duel ranking: the ranked `rows` and the `unranked` persons whose matches in the
     * selection all wait for verification (PRD #61).
     *
     * @param Standings<DuelRow> $standings
     *
     * @return array<string, mixed>
     */
    private static function duel(Game $game, Standings $standings): array
    {
        return [
            'kind' => $game->kind->value,
            'startedAt' => Instant::format($game->startedAt),
            'rows' => array_map(self::duelRow(...), $standings->rows),
            'unranked' => array_map(self::unranked(...), $standings->unranked),
        ];
    }

    /**
     * The points ranking in the game's direction: the ranked `rows` and the `unranked` persons
     * whose results in the selection all wait for verification (PRD #61).
     *
     * @param Standings<PointsRow> $standings
     *
     * @return array<string, mixed>
     */
    private static function points(Game $game, Standings $standings): array
    {
        return [
            'kind' => $game->kind->value,
            'startedAt' => Instant::format($game->startedAt),
            'lowerWins' => $game->lowerWins,
            'rows' => array_map(self::pointsRow(...), $standings->rows),
            'unranked' => array_map(self::unranked(...), $standings->unranked),
        ];
    }

    /**
     * @return array{personId: int, name: string, pendingCount: int}
     */
    private static function unranked(UnrankedPlayer $player): array
    {
        return ['personId' => $player->personId, 'name' => $player->name, 'pendingCount' => $player->pendingCount];
    }

    /**
     * @return array{personId: int, name: string, sum: int, results: int, pendingCount: int}
     */
    private static function pointsRow(PointsRow $row): array
    {
        return ['personId' => $row->personId, 'name' => $row->name, 'sum' => $row->sum, 'results' => $row->results, 'pendingCount' => $row->pendingCount];
    }

    /**
     * @return array{personId: int, name: string, points: int|float, wins: int, draws: int, losses: int, played: int, pendingCount: int}
     */
    private static function duelRow(DuelRow $row): array
    {
        return [
            'personId' => $row->personId,
            'name' => $row->name,
            'points' => Decimal::json($row->points),
            'wins' => $row->wins,
            'draws' => $row->draws,
            'losses' => $row->losses,
            'played' => $row->played,
            'pendingCount' => $row->pendingCount,
        ];
    }
}
