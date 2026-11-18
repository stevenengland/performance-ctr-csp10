<?php

declare(strict_types=1);

namespace Performance\Http;

use Performance\Domain\Games\CurrentRun;
use Performance\Domain\Games\DuelRow;
use Performance\Domain\Games\Game;
use Performance\Domain\Games\GameKind;
use Performance\Domain\Games\Measure;
use Performance\Domain\Games\PointsRow;
use Performance\Domain\Games\Standings;
use Performance\Domain\Games\UnrankedPlayer;
use Performance\Domain\Interval;
use Performance\Domain\ValidationFailed;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;

/**
 * `GET /api/games/{id}/standings`: the game's ranking in its current run, or with
 * `from=<instant>[&to=<instant>]` or `scope=all` over every match or result recorded in that
 * interval, whatever its run; tagged with its kind. A points game ranks an interval by
 * `measure=sum` (the default) or `measure=average`, and its rows there carry both. The query
 * is normalised into one selection and a measure before anything is read; only whether the
 * game is a duel, which rejects any measure, waits for the game. The game, the data revision
 * and the ranking are read in one snapshot, so the ETag (the revision, and the interval and
 * the average when there are) always names what is sent, and `If-None-Match` with an
 * unchanged tag answers 304 before anything is ranked.
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
        $measure = self::measure($request, $selection);

        return $database->snapshot()->read(static function () use ($database, $selection, $measure, $request, $response, $arguments): ResponseInterface {
            $game = $database->games()->game((int) $arguments['id']);
            if ($measure !== null && $game->kind === GameKind::Duel) {
                throw new ValidationFailed(['measure' => 'Nur bei Punktespielen.']);
            }
            $measure ??= Measure::Sum;

            return ConditionalGet::respond(
                $request,
                $response,
                self::tag($database->revision()->current(), $selection, $measure),
                static fn(ResponseInterface $response): ResponseInterface => Json::write($response, self::standings($database, $game, $selection, $measure)),
            );
        });
    }

    /**
     * The measure the query names, checked against the selection; null when it names none.
     *
     * @throws ValidationFailed naming `measure` for another value than `sum` or `average`, or
     *                          for one without a window or `scope=all`
     */
    private static function measure(ServerRequestInterface $request, Interval|CurrentRun $selection): ?Measure
    {
        $text = Query::text($request, 'measure');
        if ($text === null) {
            return null;
        }
        $measure = Measure::tryFrom($text) ?? throw new ValidationFailed(['measure' => 'Nur sum oder average.']);
        if ($selection instanceof CurrentRun) {
            throw new ValidationFailed(['measure' => 'Nur mit from oder scope=all.']);
        }

        return $measure;
    }

    /**
     * The current run's tag is the bare revision, as before; an interval adds its own part,
     * and the average its own after it. The sum, the default, adds nothing.
     */
    private static function tag(int $revision, Interval|CurrentRun $selection, Measure $measure): string
    {
        if ($selection instanceof CurrentRun) {
            return sprintf('"%d"', $revision);
        }

        return sprintf('"%d-%s%s"', $revision, IntervalQuery::tag($selection), $measure === Measure::Average ? '-average' : '');
    }

    /**
     * @return array<string, mixed>
     */
    private static function standings(Database $database, Game $game, Interval|CurrentRun $selection, Measure $measure): array
    {
        return match ($game->kind) {
            GameKind::Duel => self::duel($game, $database->matches()->standings($game, $selection)),
            GameKind::Points => self::points($game, $database->results()->standings($game, $selection, $measure), $selection instanceof Interval),
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
     * whose results in the selection all wait for verification (PRD #61). The rows of an
     * interval carry the average too; the current run's are as they were before it.
     *
     * @param Standings<PointsRow> $standings
     *
     * @return array<string, mixed>
     */
    private static function points(Game $game, Standings $standings, bool $withAverage): array
    {
        return [
            'kind' => $game->kind->value,
            'startedAt' => Instant::format($game->startedAt),
            'lowerWins' => $game->lowerWins,
            'rows' => array_map(static fn(PointsRow $row): array => self::pointsRow($row, $withAverage), $standings->rows),
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
     * The row, with its average per result rounded to one decimal after the sum when asked.
     *
     * @return array{personId: int, name: string, sum: int, average?: int|float, results: int, pendingCount: int}
     */
    private static function pointsRow(PointsRow $row, bool $withAverage): array
    {
        $average = $withAverage ? ['average' => Decimal::json($row->averageTenths() / 10)] : [];

        return ['personId' => $row->personId, 'name' => $row->name, 'sum' => $row->sum, ...$average, 'results' => $row->results, 'pendingCount' => $row->pendingCount];
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
