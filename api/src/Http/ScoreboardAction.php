<?php

declare(strict_types=1);

namespace Performance\Http;

use DateTimeImmutable;
use Performance\Domain\DrinkCount;
use Performance\Domain\ScoreRow;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;

/**
 * `GET /api/scoreboard?from=<instant>`: the standings since `from`, the start of the viewer's day.
 * The ETag names the data revision and the window, so `If-None-Match` with an
 * unchanged revision answers 304 before anything is aggregated. The revision and
 * the standings are read in one snapshot, so the tag always names what is sent.
 */
final readonly class ScoreboardAction
{
    public function __construct(private Database $database) {}

    public function __invoke(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        parse_str($request->getUri()->getQuery(), $query);
        $from = Instant::parse('from', is_string($query['from'] ?? null) ? $query['from'] : '');
        $scoreboard = $this->database->scoreboard();

        return $scoreboard->snapshot(function () use ($scoreboard, $request, $response, $from): ResponseInterface {
            $tag = self::tag($scoreboard->revision(), $from);
            $response = $response->withHeader('ETag', $tag);
            if (self::matches($request->getHeaderLine('If-None-Match'), $tag)) {
                return $response->withStatus(304);
            }

            return Json::write($response, ['rows' => array_map(self::row(...), $scoreboard->since($from))]);
        });
    }

    /** The window is part of the tag: the same revision means other standings for another day. */
    private static function tag(int $revision, DateTimeImmutable $from): string
    {
        return sprintf('"%d-%s"', $revision, $from->format('Uv'));
    }

    /**
     * Whether `If-None-Match` names the tag: `*`, or one of a list of (weak) tags, also
     * with the `-gzip`/`-br` suffix Apache adds to tags of the responses it compresses.
     */
    private static function matches(string $ifNoneMatch, string $tag): bool
    {
        foreach (explode(',', $ifNoneMatch) as $candidate) {
            $candidate = preg_replace(['/^W\//', '/-(gzip|br)"$/'], ['', '"'], trim($candidate));
            if ($candidate === '*' || $candidate === $tag) {
                return true;
            }
        }

        return false;
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
