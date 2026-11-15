<?php

declare(strict_types=1);

namespace Performance\Tests\Support;

use DateInterval;
use DateTimeImmutable;
use DateTimeZone;
use Performance\Domain\Clock;

/** A clock that stands still until a test lets time pass. */
final class TestClock implements Clock
{
    private DateTimeImmutable $now;

    public function __construct(string $start = '2026-11-14 20:00:00')
    {
        $this->now = new DateTimeImmutable($start, new DateTimeZone('UTC'));
    }

    public function now(): DateTimeImmutable
    {
        return $this->now;
    }

    /** @param string $interval an ISO-8601 duration such as `P179D` */
    public function advance(string $interval): void
    {
        $this->now = $this->now->add(new DateInterval($interval));
    }
}
