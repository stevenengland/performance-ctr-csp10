<?php

declare(strict_types=1);

namespace Performance\Http;

use DateTimeImmutable;
use Performance\Domain\Games\GameKind;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;

/**
 * The days-with-data reads (PRD #70), the raw material of the calendar's marks and the all-time
 * line: `GET /api/scoreboard/days` for the drinks and `GET /api/games/{id}/standings/days` for a
 * game across all its runs. Each answers `{"instants": [...]}`, the start instants, ascending,
 * of the 15-minute UTC buckets with a row its ranking counts (see QuarterHours). The ETag is
 * the data revision, read in the same snapshot as the instants, so `If-None-Match` with an
 * unchanged revision answers 304 before anything is read.
 */
final readonly class DaysActions
{
    public function __construct(private Database $database) {}

    public function drinks(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        $database = $this->database;

        return $database->snapshot()->read(static fn(): ResponseInterface => self::respond(
            $request,
            $response,
            $database,
            static fn(): array => $database->scoreboard()->days(),
        ));
    }

    /**
     * @param array{id: string} $arguments the game's id
     */
    public function game(ServerRequestInterface $request, ResponseInterface $response, array $arguments): ResponseInterface
    {
        $database = $this->database;

        return $database->snapshot()->read(static function () use ($request, $response, $database, $arguments): ResponseInterface {
            $game = $database->games()->game((int) $arguments['id']);

            return self::respond($request, $response, $database, static fn(): array => match ($game->kind) {
                GameKind::Duel => $database->matches()->days($game->id),
                GameKind::Points => $database->results()->days($game->id),
            });
        });
    }

    /**
     * @param callable(): list<DateTimeImmutable> $days
     */
    private static function respond(ServerRequestInterface $request, ResponseInterface $response, Database $database, callable $days): ResponseInterface
    {
        return ConditionalGet::respond(
            $request,
            $response,
            sprintf('"%d"', $database->revision()->current()),
            static fn(ResponseInterface $response): ResponseInterface => Json::write($response, ['instants' => array_map(Instant::format(...), $days())]),
        );
    }
}
