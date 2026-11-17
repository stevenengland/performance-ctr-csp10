<?php

declare(strict_types=1);

namespace Performance\Http;

use Performance\Domain\Games\GameHistory;
use Performance\Domain\Games\Result;
use Performance\Domain\Games\ResultItem;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;

/**
 * `/api/results/{uuid}`: record one person's points in a points game idempotently on the
 * client's UUID, and delete them (undo). `GET /api/games/{id}/results?before=<cursor>&limit=<n>`:
 * a page of the game's Verlauf, newest first, and the `before` of the next older page.
 */
final readonly class ResultActions
{
    public function __construct(private Database $database) {}

    /**
     * @param array{id: string} $arguments the game's id
     */
    public function list(ServerRequestInterface $request, ResponseInterface $response, array $arguments): ResponseInterface
    {
        $page = $this->database->results()->history(
            $this->database->games()->game((int) $arguments['id']),
            Query::text($request, 'before'),
            Query::integer($request, 'limit') ?? GameHistory::PAGE_SIZE,
        );

        return Json::write($response, ['items' => array_map(self::item(...), $page->items), 'next' => $page->next]);
    }

    /**
     * @param array{id: string} $arguments
     */
    public function put(ServerRequestInterface $request, ResponseInterface $response, array $arguments): ResponseInterface
    {
        $recorded = $this->database->results()->record(
            SessionAuth::actor($request),
            $arguments['id'],
            Input::integer($request, 'gameId'),
            Input::integer($request, 'personId'),
            Input::integer($request, 'points'),
        );

        return Json::write($response, self::result($recorded->result), $recorded->created ? 201 : 200);
    }

    /**
     * @param array{id: string} $arguments
     */
    public function delete(ServerRequestInterface $request, ResponseInterface $response, array $arguments): ResponseInterface
    {
        $this->database->results()->delete(SessionAuth::actor($request), $arguments['id']);

        return $response->withStatus(204);
    }

    /**
     * @return array{id: string, gameId: int, personId: int, points: int, createdAt: string}
     */
    private static function result(Result $result): array
    {
        return [
            'id' => $result->id,
            'gameId' => $result->gameId,
            'personId' => $result->personId,
            'points' => $result->points,
            'createdAt' => Instant::format($result->createdAt),
        ];
    }

    /**
     * @return array{id: string, person: array{id: int, name: string}, points: int, createdAt: string, accountName: string|null, pending: bool}
     */
    private static function item(ResultItem $item): array
    {
        return [
            'id' => $item->id,
            'person' => ['id' => $item->person->id, 'name' => $item->person->name],
            'points' => $item->points,
            'createdAt' => Instant::format($item->createdAt),
            'accountName' => $item->accountName,
            'pending' => $item->pending,
        ];
    }
}
