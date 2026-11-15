<?php

declare(strict_types=1);

namespace Performance\Http;

use Performance\Domain\DrinkCount;
use Performance\Domain\ScoreRow;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;

/**
 * `GET /api/scoreboard?from=<instant>`: the standings since `from`, the start of the viewer's day.
 */
final readonly class ScoreboardAction
{
    public function __construct(private Database $database) {}

    public function __invoke(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        parse_str($request->getUri()->getQuery(), $query);
        $from = Instant::parse('from', is_string($query['from'] ?? null) ? $query['from'] : '');

        return Json::write($response, ['rows' => array_map(self::row(...), $this->database->scoreboard()->since($from))]);
    }

    /**
     * @return array{personId: int, name: string, score: int|float, count: int|float, drinks: list<array{drinkId: int, name: string, count: int|float}>}
     */
    private static function row(ScoreRow $row): array
    {
        return [
            'personId' => $row->personId,
            'name' => $row->name,
            'score' => Decimal::json($row->score),
            'count' => Decimal::json($row->count),
            'drinks' => array_map(
                static fn(DrinkCount $drink): array => ['drinkId' => $drink->drinkId, 'name' => $drink->name, 'count' => Decimal::json($drink->count)],
                $row->drinks,
            ),
        ];
    }
}
