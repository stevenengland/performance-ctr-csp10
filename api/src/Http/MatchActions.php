<?php

declare(strict_types=1);

namespace Performance\Http;

use Performance\Domain\Games\DuelMatch;
use Performance\Domain\Games\GameHistory;
use Performance\Domain\Games\MatchItem;
use Performance\Domain\Games\PersonRef;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;

/**
 * `/api/matches/{uuid}`: record a match of a duel game idempotently on the client's UUID, and
 * delete it (undo). `GET /api/games/{id}/matches?before=<cursor>&limit=<n>`: a page of the
 * game's Verlauf, newest first, and the `before` of the next older page.
 */
final readonly class MatchActions
{
    public function __construct(private Database $database) {}

    /**
     * @param array{id: string} $arguments the game's id
     */
    public function list(ServerRequestInterface $request, ResponseInterface $response, array $arguments): ResponseInterface
    {
        $page = $this->database->matches()->history(
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

    /**
     * @return array{id: string, first: array{id: int, name: string}|null, second: array{id: int, name: string}|null, outcome: string, createdAt: string, accountName: string|null, pending: bool}
     */
    private static function item(MatchItem $item): array
    {
        return [
            'id' => $item->id,
            'first' => self::person($item->first),
            'second' => self::person($item->second),
            'outcome' => $item->outcome->value,
            'createdAt' => Instant::format($item->createdAt),
            'accountName' => $item->accountName,
            'pending' => $item->pending,
        ];
    }

    /**
     * @return array{id: int, name: string}|null
     */
    private static function person(?PersonRef $person): ?array
    {
        return $person === null ? null : ['id' => $person->id, 'name' => $person->name];
    }
}
