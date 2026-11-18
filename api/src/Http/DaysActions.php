<?php

declare(strict_types=1);

namespace Performance\Http;

use Performance\Domain\Games\GameKind;
use Performance\Domain\Interval;
use Performance\Domain\Span;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;

/**
 * The days-with-data reads (PRD #70), the raw material of the calendar's marks and the all-time
 * line: `GET /api/scoreboard/days` for the drinks and `GET /api/games/{id}/standings/days` for a
 * game across all its runs. Each takes a window `from`–`to` of at most LONGEST_WINDOW_DAYS days
 * (the calendar's month) or `scope=all` (the `Gesamt` line), and answers
 * `{"spans": [{"from": …, "to": …}]}`, the runs of consecutive 15-minute UTC buckets with a row
 * its ranking counts (see QuarterHours). The ETag names the data revision, read in the same
 * snapshot as the spans, and the selection, so `If-None-Match` with an unchanged revision
 * answers 304 before anything is read.
 */
final readonly class DaysActions
{
    /** The longest window a days read takes: a local month and a margin. */
    public const LONGEST_WINDOW_DAYS = 35;

    public function __construct(private Database $database) {}

    public function drinks(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        $interval = self::interval($request);
        $database = $this->database;

        return $database->snapshot()->read(static fn(): ResponseInterface => self::respond(
            $request,
            $response,
            $database,
            $interval,
            static fn(): array => $database->scoreboard()->days($interval),
        ));
    }

    /**
     * The window is checked before the game is looked up, as the standings check theirs.
     *
     * @param array{id: string} $arguments the game's id
     */
    public function game(ServerRequestInterface $request, ResponseInterface $response, array $arguments): ResponseInterface
    {
        $interval = self::interval($request);
        $database = $this->database;

        return $database->snapshot()->read(static function () use ($request, $response, $database, $interval, $arguments): ResponseInterface {
            $game = $database->games()->game((int) $arguments['id']);

            return self::respond($request, $response, $database, $interval, static fn(): array => match ($game->kind) {
                GameKind::Duel => $database->matches()->days($game->id, $interval),
                GameKind::Points => $database->results()->days($game->id, $interval),
            });
        });
    }

    private static function interval(ServerRequestInterface $request): Interval
    {
        return IntervalQuery::boundedWindowOrAllTime($request, self::LONGEST_WINDOW_DAYS);
    }

    /**
     * @param callable(): list<Span> $days
     */
    private static function respond(ServerRequestInterface $request, ResponseInterface $response, Database $database, Interval $interval, callable $days): ResponseInterface
    {
        return ConditionalGet::respond(
            $request,
            $response,
            sprintf('"%d-%s"', $database->revision()->current(), IntervalQuery::tag($interval)),
            static fn(ResponseInterface $response): ResponseInterface => Json::write($response, ['spans' => array_map(
                static fn(Span $span): array => ['from' => Instant::format($span->from), 'to' => Instant::format($span->to)],
                $days(),
            )]),
        );
    }
}
