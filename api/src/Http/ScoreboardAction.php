<?php

declare(strict_types=1);

namespace Performance\Http;

use Performance\Domain\DrinkCount;
use Performance\Domain\DrinkStandings;
use Performance\Domain\Interval;
use Performance\Domain\ScoreRow;
use Performance\Domain\UnrankedRow;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;

/**
 * `GET /api/scoreboard?from=<instant>[&to=<instant>]` or `?scope=all`: the standings in the
 * window `[from, to)` (from the start of the viewer's day when there is no end) or of all time:
 * the ranked `rows` and the `unranked` persons whose entries all wait for verification.
 * The ETag names the data revision and the selection, so `If-None-Match` with an
 * unchanged revision and the same selection answers 304 before anything is aggregated. The revision and
 * the standings are read in one snapshot, so the tag always names what is sent.
 */
final readonly class ScoreboardAction
{
    public function __construct(private Database $database, private PhotoUrl $photoUrl) {}

    public function __invoke(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        $interval = IntervalQuery::windowOrAllTime($request);
        $scoreboard = $this->database->scoreboard();
        $photoUrl = $this->photoUrl;

        // The revision and the standings are read in one Snapshot, so they see the same
        // committed data: the per-drink counters add up to each person's count.
        return $this->database->snapshot()->read(static fn(): ResponseInterface => ConditionalGet::respond(
            $request,
            $response,
            self::tag($scoreboard->revision(), $interval),
            static fn(ResponseInterface $response): ResponseInterface => Json::write($response, self::standings($scoreboard->in($interval), $photoUrl)),
        ));
    }

    /** The interval is part of the tag: the same revision means other standings for another day. */
    private static function tag(int $revision, Interval $interval): string
    {
        return sprintf('"%d-%s"', $revision, IntervalQuery::tag($interval));
    }

    /**
     * @return array{rows: list<array<string, mixed>>, unranked: list<array<string, mixed>>}
     */
    private static function standings(DrinkStandings $standings, PhotoUrl $photoUrl): array
    {
        return [
            'rows' => array_map(static fn(ScoreRow $row): array => self::row($row, $photoUrl), $standings->rows),
            'unranked' => array_map(static fn(UnrankedRow $row): array => self::unranked($row, $photoUrl), $standings->unranked),
        ];
    }

    /**
     * A person's standing, with the URL of their photo.
     *
     * @return array{personId: int, name: string, photoUrl: string|null, score: int|float, count: int|float, rawCount: int|float, pendingCount: int, drinks: list<array{drinkId: int, name: string, count: int|float, recordedCount: int|float, rawCount: int|float, rawRecordedCount: int|float}>}
     */
    private static function row(ScoreRow $row, PhotoUrl $photoUrl): array
    {
        return [
            'personId' => $row->personId,
            'name' => $row->name,
            'photoUrl' => $photoUrl->of($row->personId, $row->photoVersion),
            'score' => Decimal::json($row->score),
            'count' => Decimal::json($row->count),
            'rawCount' => Decimal::json($row->rawCount),
            'pendingCount' => $row->pendingCount,
            'drinks' => self::drinks($row->drinks),
        ];
    }

    /**
     * A person without a rank, with the URL of their photo.
     *
     * @return array{personId: int, name: string, photoUrl: string|null, pendingCount: int, drinks: list<array{drinkId: int, name: string, count: int|float, recordedCount: int|float, rawCount: int|float, rawRecordedCount: int|float}>}
     */
    private static function unranked(UnrankedRow $row, PhotoUrl $photoUrl): array
    {
        return [
            'personId' => $row->personId,
            'name' => $row->name,
            'photoUrl' => $photoUrl->of($row->personId, $row->photoVersion),
            'pendingCount' => $row->pendingCount,
            'drinks' => self::drinks($row->drinks),
        ];
    }

    /**
     * @param list<DrinkCount> $drinks
     *
     * @return list<array{drinkId: int, name: string, count: int|float, recordedCount: int|float, rawCount: int|float, rawRecordedCount: int|float}>
     */
    private static function drinks(array $drinks): array
    {
        return array_map(
            static fn(DrinkCount $drink): array => [
                'drinkId' => $drink->drinkId,
                'name' => $drink->name,
                'count' => Decimal::json($drink->count),
                'recordedCount' => Decimal::json($drink->recordedCount),
                'rawCount' => Decimal::json($drink->rawCount),
                'rawRecordedCount' => Decimal::json($drink->rawRecordedCount),
            ],
            $drinks,
        );
    }
}
