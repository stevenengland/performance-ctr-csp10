<?php

declare(strict_types=1);

namespace Performance\Http;

use Performance\Domain\Games\DuelRow;
use Performance\Domain\Games\Game;
use Performance\Domain\Games\GameKind;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;

/**
 * `GET /api/games/{id}/standings`: the game's ranking in its current run, tagged with its kind.
 * The game, the data revision and the ranking are read in one snapshot, so the ETag (the
 * revision) always names what is sent, and `If-None-Match` with an unchanged revision answers
 * 304 before anything is ranked. A points game has no rows until results can be recorded.
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

        return $database->snapshot()->read(static function () use ($database, $request, $response, $arguments): ResponseInterface {
            $game = $database->games()->game((int) $arguments['id']);

            return ConditionalGet::respond(
                $request,
                $response,
                sprintf('"%d"', $database->revision()->current()),
                static fn(ResponseInterface $response): ResponseInterface => Json::write($response, self::standings($database, $game)),
            );
        });
    }

    /**
     * @return array<string, mixed>
     */
    private static function standings(Database $database, Game $game): array
    {
        return match ($game->kind) {
            GameKind::Duel => [
                'kind' => $game->kind->value,
                'startedAt' => Instant::format($game->startedAt),
                'rows' => array_map(self::duelRow(...), $database->matches()->standings($game->id, $game->run)),
            ],
            GameKind::Points => [
                'kind' => $game->kind->value,
                'startedAt' => Instant::format($game->startedAt),
                'lowerWins' => $game->lowerWins,
                'rows' => [],
            ],
        };
    }

    /**
     * @return array{personId: int, name: string, points: int|float, wins: int, draws: int, losses: int, played: int}
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
        ];
    }
}
