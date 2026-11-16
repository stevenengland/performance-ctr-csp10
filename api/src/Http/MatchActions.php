<?php

declare(strict_types=1);

namespace Performance\Http;

use Performance\Domain\Games\DuelMatch;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;

/**
 * `/api/matches/{uuid}`: record a match of a duel game idempotently on the client's UUID, and
 * delete it (undo).
 */
final readonly class MatchActions
{
    public function __construct(private Database $database) {}

    /**
     * @param array{id: string} $arguments
     */
    public function put(ServerRequestInterface $request, ResponseInterface $response, array $arguments): ResponseInterface
    {
        $recorded = $this->database->matches()->record(
            SessionAuth::actor($request),
            $arguments['id'],
            Input::integer($request, 'gameId'),
            Input::integer($request, 'firstPersonId'),
            Input::integer($request, 'secondPersonId'),
            Input::optionalText($request, 'outcome'),
        );

        return Json::write($response, self::match($recorded->match), $recorded->created ? 201 : 200);
    }

    /**
     * @param array{id: string} $arguments
     */
    public function delete(ServerRequestInterface $request, ResponseInterface $response, array $arguments): ResponseInterface
    {
        $this->database->matches()->delete(SessionAuth::actor($request), $arguments['id']);

        return $response->withStatus(204);
    }

    /**
     * @return array{id: string, gameId: int, firstPersonId: int, secondPersonId: int, outcome: string, createdAt: string}
     */
    private static function match(DuelMatch $match): array
    {
        return [
            'id' => $match->id,
            'gameId' => $match->gameId,
            'firstPersonId' => $match->firstPersonId,
            'secondPersonId' => $match->secondPersonId,
            'outcome' => $match->outcome->value,
            'createdAt' => Instant::format($match->createdAt),
        ];
    }
}
