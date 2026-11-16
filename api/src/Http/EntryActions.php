<?php

declare(strict_types=1);

namespace Performance\Http;

use Performance\Domain\Entry;
use Performance\Domain\HistoryEntry;
use Performance\Domain\HistoryFactor;
use Performance\Domain\ValidationFailed;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;

/**
 * `/api/entries/{id}`: add an entry idempotently on the client's id, and delete it.
 * `/api/entries?personId=&from=`: a person's entries since `from`, newest first.
 */
final readonly class EntryActions
{
    /** A lower-case UUID v4, as `crypto.randomUUID()` makes it. */
    public const ID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';

    public function __construct(private Database $database) {}

    public function list(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        parse_str($request->getUri()->getQuery(), $query);
        $personId = is_string($query['personId'] ?? null) ? $query['personId'] : '';
        if (preg_match('/^' . CatalogActions::ID_PATTERN . '$/D', $personId) !== 1) {
            throw new ValidationFailed(['personId' => 'Person nicht gefunden.']);
        }
        $from = Instant::parse('from', is_string($query['from'] ?? null) ? $query['from'] : '');

        $entries = $this->database->entries()->ofPersonSince((int) $personId, $from);

        return Json::write($response, ['entries' => array_map(self::historyEntry(...), $entries)]);
    }

    /**
     * @param array{id: string} $arguments
     */
    public function put(ServerRequestInterface $request, ResponseInterface $response, array $arguments): ResponseInterface
    {
        $added = $this->database->entries()->add(
            SessionAuth::actor($request),
            $arguments['id'],
            Input::integer($request, 'personId'),
            Input::integer($request, 'drinkId'),
            Input::integer($request, 'quantity'),
            Input::optionalId($request, 'factorId'),
        );

        return Json::write($response, self::entry($added->entry), $added->created ? 201 : 200);
    }

    /**
     * @param array{id: string} $arguments
     */
    public function delete(ServerRequestInterface $request, ResponseInterface $response, array $arguments): ResponseInterface
    {
        $this->database->entries()->delete(SessionAuth::actor($request), $arguments['id']);

        return $response->withStatus(204);
    }

    /**
     * @return array{id: string, personId: int, drinkId: int, quantity: int, factorId: int|null, createdAt: string}
     */
    private static function entry(Entry $entry): array
    {
        return [
            'id' => $entry->id,
            'personId' => $entry->personId,
            'drinkId' => $entry->drinkId,
            'quantity' => $entry->quantity,
            'factorId' => $entry->factorId,
            'createdAt' => Instant::format($entry->createdAt),
        ];
    }

    /**
     * @return array{id: string, drink: array{id: int, name: string}, quantity: int, factor: array{id: int, name: string, multiplier: int|float}|null, createdAt: string, accountName: string|null, pending: bool}
     */
    private static function historyEntry(HistoryEntry $entry): array
    {
        return [
            'id' => $entry->id,
            'drink' => ['id' => $entry->drinkId, 'name' => $entry->drinkName],
            'quantity' => $entry->quantity,
            'factor' => $entry->factor === null ? null : self::factor($entry->factor),
            'createdAt' => Instant::format($entry->createdAt),
            'accountName' => $entry->accountName,
            'pending' => $entry->pending,
        ];
    }

    /**
     * @return array{id: int, name: string, multiplier: int|float}
     */
    private static function factor(HistoryFactor $factor): array
    {
        return ['id' => $factor->id, 'name' => $factor->name, 'multiplier' => Decimal::json($factor->multiplier)];
    }
}
