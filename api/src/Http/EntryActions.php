<?php

declare(strict_types=1);

namespace Performance\Http;

use Performance\Domain\Entry;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;

/**
 * `/api/entries/{id}`: add an entry idempotently on the client's id, and delete it.
 */
final readonly class EntryActions
{
    /** A lower-case UUID v4, as `crypto.randomUUID()` makes it. */
    public const ID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';

    public function __construct(private Database $database) {}

    /**
     * @param array{id: string} $arguments
     */
    public function put(ServerRequestInterface $request, ResponseInterface $response, array $arguments): ResponseInterface
    {
        $added = $this->database->entries()->add(
            $arguments['id'],
            Input::integer($request, 'personId'),
            Input::integer($request, 'drinkId'),
            Input::integer($request, 'quantity'),
            SessionAuth::account($request)->id,
        );

        return Json::write($response, self::entry($added->entry), $added->created ? 201 : 200);
    }

    /**
     * @param array{id: string} $arguments
     */
    public function delete(ServerRequestInterface $request, ResponseInterface $response, array $arguments): ResponseInterface
    {
        $this->database->entries()->delete($arguments['id']);

        return $response->withStatus(204);
    }

    /**
     * @return array{id: string, personId: int, drinkId: int, quantity: int, createdAt: string}
     */
    private static function entry(Entry $entry): array
    {
        return [
            'id' => $entry->id,
            'personId' => $entry->personId,
            'drinkId' => $entry->drinkId,
            'quantity' => $entry->quantity,
            'createdAt' => Instant::format($entry->createdAt),
        ];
    }
}
