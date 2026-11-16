<?php

declare(strict_types=1);

namespace Performance\Http;

use Performance\Domain\Games\Game;
use Performance\Domain\Games\GameKind;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;

/**
 * `/api/games`: list and create; `…/{id}` reads (with the number of its matches or results of
 * every run), edits and deletes; `…/{id}/restart` starts the game's next run.
 */
final readonly class GameActions
{
    public function __construct(private Database $database) {}

    public function list(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        return Json::write($response, ['games' => array_map(self::game(...), $this->database->games()->all())]);
    }

    public function create(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        $game = $this->database->games()->create(
            SessionAuth::actor($request),
            Input::text($request, 'name'),
            Input::optionalText($request, 'kind'),
            Input::optionalBoolean($request, 'drawsAllowed'),
            Input::optionalBoolean($request, 'lowerWins'),
        );

        return Json::write($response, self::game($game), 201);
    }

    /**
     * @param array{id: string} $arguments
     */
    public function read(ServerRequestInterface $request, ResponseInterface $response, array $arguments): ResponseInterface
    {
        $games = $this->database->games();
        $game = $games->game((int) $arguments['id']);
        $rows = $games->dependentCount($game->id);

        return Json::write($response, [
            ...self::game($game),
            'matchCount' => $game->kind === GameKind::Duel ? $rows : 0,
            'resultCount' => $game->kind === GameKind::Points ? $rows : 0,
        ]);
    }

    /**
     * @param array{id: string} $arguments
     */
    public function update(ServerRequestInterface $request, ResponseInterface $response, array $arguments): ResponseInterface
    {
        $game = $this->database->games()->update(
            SessionAuth::actor($request),
            (int) $arguments['id'],
            Input::text($request, 'name'),
            Input::optionalText($request, 'kind'),
            Input::optionalBoolean($request, 'drawsAllowed'),
            Input::optionalBoolean($request, 'lowerWins'),
        );

        return Json::write($response, self::game($game));
    }

    /**
     * @param array{id: string} $arguments
     */
    public function restart(ServerRequestInterface $request, ResponseInterface $response, array $arguments): ResponseInterface
    {
        return Json::write($response, self::game($this->database->games()->restart(SessionAuth::actor($request), (int) $arguments['id'])));
    }

    /**
     * @param array{id: string} $arguments
     */
    public function delete(ServerRequestInterface $request, ResponseInterface $response, array $arguments): ResponseInterface
    {
        $this->database->games()->delete(SessionAuth::actor($request), (int) $arguments['id']);

        return $response->withStatus(204);
    }

    /**
     * @return array{id: int, name: string, kind: string, drawsAllowed: bool, lowerWins: bool, startedAt: string}
     */
    private static function game(Game $game): array
    {
        return [
            'id' => $game->id,
            'name' => $game->name,
            'kind' => $game->kind->value,
            'drawsAllowed' => $game->drawsAllowed,
            'lowerWins' => $game->lowerWins,
            'startedAt' => Instant::format($game->startedAt),
        ];
    }
}
