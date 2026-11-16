<?php

declare(strict_types=1);

namespace Performance\Http;

use Performance\Domain\HistoryFactor;
use Performance\Domain\PendingItem;
use Performance\Domain\PendingPage;
use Performance\Domain\VerifiableKind;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;

/**
 * The four-eyes rule (PRD #61). `PUT /api/entries/{id}/verification`: another account than
 * the recorder lets a pending entry count; repeating it changes nothing.
 * `GET /api/pending?cursor=`: a page of the rows the signed-in account may verify, the `next`
 * page's cursor and the `count` of all of them.
 */
final readonly class VerificationActions
{
    public function __construct(private Database $database) {}

    /**
     * The first page answers conditionally: its ETag names the data revision and the account,
     * since every account has its own queue. The revision, the items and the count are read in
     * one snapshot, so the tag always names what is sent. A later page has no ETag.
     */
    public function queue(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        $database = $this->database;
        $accountId = SessionAuth::actor($request)->accountId;
        $cursor = Query::text($request, 'cursor');
        $page = static fn(): PendingPage => $database->verification()->queue($accountId, $cursor);

        return $database->snapshot()->read(static fn(): ResponseInterface => $cursor === null
            ? ConditionalGet::respond(
                $request,
                $response,
                sprintf('"%d-%d"', $database->revision()->current(), $accountId),
                static fn(ResponseInterface $response): ResponseInterface => Json::write($response, self::page($page())),
            )
            : Json::write($response, self::page($page())));
    }

    /**
     * @param array{id: string} $arguments
     */
    public function verifyEntry(ServerRequestInterface $request, ResponseInterface $response, array $arguments): ResponseInterface
    {
        $this->database->verification()->verify(SessionAuth::actor($request), VerifiableKind::Entry, $arguments['id']);

        return $response->withStatus(204);
    }

    /**
     * @return array{items: list<array<string, mixed>>, next: string|null, count: int}
     */
    private static function page(PendingPage $page): array
    {
        return ['items' => array_map(self::item(...), $page->items), 'next' => $page->next, 'count' => $page->count];
    }

    /**
     * @return array<string, mixed>
     */
    private static function item(PendingItem $item): array
    {
        $entry = $item->details;

        return [
            'kind' => $item->kind->value,
            'id' => $item->id,
            'createdAt' => Instant::format($item->createdAt),
            'accountName' => $item->accountName,
            'person' => ['id' => $entry->personId, 'name' => $entry->personName],
            'drink' => ['id' => $entry->drinkId, 'name' => $entry->drinkName],
            'quantity' => $entry->quantity,
            'factor' => $entry->factor === null ? null : self::factor($entry->factor),
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
