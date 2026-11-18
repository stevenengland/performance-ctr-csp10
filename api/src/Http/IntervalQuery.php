<?php

declare(strict_types=1);

namespace Performance\Http;

use DateInterval;
use Performance\Domain\Games\CurrentRun;
use Performance\Domain\Interval;
use Performance\Domain\ValidationFailed;
use Psr\Http\Message\ServerRequestInterface;

/**
 * The one place that turns the query of a windowed read into an Interval, so every such read
 * accepts and rejects the same windows with the same problem: `from` (inclusive) with an
 * optional `to` (exclusive), ISO-8601 instants with offset, or, where a read offers all time,
 * `scope=all` instead of both.
 */
final class IntervalQuery
{
    /**
     * `from` with an optional `to`, as a person's entry list takes it.
     *
     * @throws ValidationFailed naming `from` when it is missing or no instant, `to` when it is
     *                          no instant or not after `from`
     */
    public static function window(ServerRequestInterface $request): Interval
    {
        $from = Instant::parse('from', Query::text($request, 'from') ?? '');
        $to = Query::text($request, 'to');

        return Interval::window($from, $to === null ? null : Instant::parse('to', $to));
    }

    /**
     * A window, or all time with `scope=all`, as the scoreboard takes it.
     *
     * @throws ValidationFailed as window(), and naming `scope` for another value or for
     *                          `scope=all` together with `from` or `to`
     */
    public static function windowOrAllTime(ServerRequestInterface $request): Interval
    {
        $scope = Query::text($request, 'scope');
        if ($scope === null) {
            return self::window($request);
        }
        if ($scope !== 'all') {
            throw new ValidationFailed(['scope' => 'Nur all.']);
        }
        if (Query::text($request, 'from') !== null || Query::text($request, 'to') !== null) {
            throw new ValidationFailed(['scope' => 'Nicht zusammen mit from oder to.']);
        }

        return Interval::allTime();
    }

    /**
     * A window with an end at most `$longestDays` days after its start, or all time with
     * `scope=all`, as the days-with-data reads take it: their cost and size grow with the
     * window's length, so a window has an end and a bound.
     *
     * @throws ValidationFailed as windowOrAllTime(), and naming `to` when it is missing or more
     *                          than `$longestDays` days after `from`
     */
    public static function boundedWindowOrAllTime(ServerRequestInterface $request, int $longestDays): Interval
    {
        $interval = self::windowOrAllTime($request);
        if ($interval->from === null) {
            return $interval;
        }
        if ($interval->to === null) {
            throw new ValidationFailed(['to' => 'Zeitpunkt nach ISO 8601 mit Zeitzone.']);
        }
        if ($interval->to > $interval->from->add(new DateInterval("P{$longestDays}D"))) {
            throw new ValidationFailed(['to' => "Höchstens {$longestDays} Tage nach from."]);
        }

        return $interval;
    }

    /**
     * The current run without `from`, `to` and `scope`, else a window or all time, as a game's
     * standings take it: whatever names a period is checked as the scoreboard checks it.
     *
     * @throws ValidationFailed as windowOrAllTime()
     */
    public static function windowAllTimeOrCurrentRun(ServerRequestInterface $request): Interval|CurrentRun
    {
        foreach (['from', 'to', 'scope'] as $name) {
            if (Query::text($request, $name) !== null) {
                return self::windowOrAllTime($request);
            }
        }

        return new CurrentRun();
    }

    /**
     * The interval's part of an ETag: a window starting at the same instant without an end is
     * named as it was before windows had one.
     */
    public static function tag(Interval $interval): string
    {
        if ($interval->from === null) {
            return 'all';
        }

        return $interval->to === null
            ? $interval->from->format('Uv')
            : $interval->from->format('Uv') . '-' . $interval->to->format('Uv');
    }
}
