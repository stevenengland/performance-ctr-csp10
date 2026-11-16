<?php

declare(strict_types=1);

namespace Performance\Http;

use Performance\Domain\Games\PersonRef;
use Performance\Domain\HistoryFactor;
use Performance\Domain\PendingEntry;
use Performance\Domain\PendingItem;
use Performance\Domain\PendingMatch;
use Performance\Domain\PendingPage;
use Performance\Domain\PendingResult;
use Performance\Domain\VerifiableKind;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;

/**
 * The four-eyes rule (PRD #61). `PUT /api/{entries|matches|results}/{id}/verification`: another account
 * than the recorder lets a pending row count; repeating it changes nothing.
 * `DELETE /api/{entries|matches|results}/{id}/verification`: such an account rejects a pending row,
 * which removes it.
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
     * @param array{id: string} $arguments
     */
    public function rejectEntry(ServerRequestInterface $request, ResponseInterface $response, array $arguments): ResponseInterface
    {
        $this->database->verification()->reject(SessionAuth::actor($request), VerifiableKind::Entry, $arguments['id']);

        return $response->withStatus(204);
    }

    /**
     * @param array{id: string} $arguments
     */
    public function verifyMatch(ServerRequestInterface $request, ResponseInterface $response, array $arguments): ResponseInterface
    {
        $this->database->verification()->verify(SessionAuth::actor($request), VerifiableKind::Match, $arguments['id']);

        return $response->withStatus(204);
    }

    /**
     * @param array{id: string} $arguments
     */
    public function rejectMatch(ServerRequestInterface $request, ResponseInterface $response, array $arguments): ResponseInterface
    {
        $this->database->verification()->reject(SessionAuth::actor($request), VerifiableKind::Match, $arguments['id']);

        return $response->withStatus(204);
    }

    /**
     * @param array{id: string} $arguments
     */
    public function verifyResult(ServerRequestInterface $request, ResponseInterface $response, array $arguments): ResponseInterface
    {
        $this->database->verification()->verify(SessionAuth::actor($request), VerifiableKind::Result, $arguments['id']);

        return $response->withStatus(204);
    }

    /**
     * @param array{id: string} $arguments
     */
    public function rejectResult(ServerRequestInterface $request, ResponseInterface $response, array $arguments): ResponseInterface
    {
        $this->database->verification()->reject(SessionAuth::actor($request), VerifiableKind::Result, $arguments['id']);

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
        $common = [
            'kind' => $item->kind->value,
            'id' => $item->id,
            'createdAt' => Instant::format($item->createdAt),
            'accountName' => $item->accountName,
        ];
        $details = $item->details;

        return [...$common, ...match (true) {
            $details instanceof PendingEntry => self::entry($details),
            $details instanceof PendingMatch => self::match($details),
            $details instanceof PendingResult => self::result($details),
        }];
    }

    /**
     * @return array<string, mixed>
     */
    private static function entry(PendingEntry $entry): array
    {
        return [
            'person' => ['id' => $entry->personId, 'name' => $entry->personName],
            'drink' => ['id' => $entry->drinkId, 'name' => $entry->drinkName],
            'quantity' => $entry->quantity,
            'factor' => $entry->factor === null ? null : self::factor($entry->factor),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private static function match(PendingMatch $match): array
    {
        return [
            'game' => ['id' => $match->gameId, 'name' => $match->gameName],
            'earlierRun' => $match->earlierRun,
            'first' => self::person($match->first),
            'second' => self::person($match->second),
            'outcome' => $match->outcome->value,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private static function result(PendingResult $result): array
    {
        return [
            'game' => ['id' => $result->gameId, 'name' => $result->gameName],
            'earlierRun' => $result->earlierRun,
            'person' => self::person($result->person),
            'points' => $result->points,
        ];
    }

    /**
     * @return array{id: int, name: string}|null
     */
    private static function person(?PersonRef $person): ?array
    {
        return $person === null ? null : ['id' => $person->id, 'name' => $person->name];
    }

    /**
     * @return array{id: int, name: string, multiplier: int|float}
     */
    private static function factor(HistoryFactor $factor): array
    {
        return ['id' => $factor->id, 'name' => $factor->name, 'multiplier' => Decimal::json($factor->multiplier)];
    }
}
