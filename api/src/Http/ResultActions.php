<?php

declare(strict_types=1);

namespace Performance\Http;

use Performance\Domain\Games\Result;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;

/**
 * `/api/results/{uuid}`: record one person's points in a points game idempotently on the
 * client's UUID, and delete them (undo).
 */
final readonly class ResultActions
{
    public function __construct(private Database $database) {}

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
}
