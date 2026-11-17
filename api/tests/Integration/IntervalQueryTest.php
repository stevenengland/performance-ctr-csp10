<?php

declare(strict_types=1);

namespace Performance\Tests\Integration;

use Performance\Tests\Support\DatabaseTestCase;
use PHPUnit\Framework\Attributes\DataProvider;

/**
 * Every windowed read takes `from` and an optional `to` alike: the same window is rejected
 * by each with the same problem.
 */
final class IntervalQueryTest extends DatabaseTestCase
{
    private const INSTANT = 'Zeitpunkt nach ISO 8601 mit Zeitzone.';

    private string $session;

    protected function setUp(): void
    {
        parent::setUp();
        $this->session = $this->signIn();
        $this->send('POST', '/api/persons', ['name' => 'Daniel'], $this->session);
    }

    /**
     * @return iterable<string, array{string, array<string, string>}>
     */
    public static function invalidWindows(): iterable
    {
        yield 'an empty end' => ['from=2026-11-13T23:00:00Z&to=', ['to' => self::INSTANT]];
        yield 'an end that is a date only' => ['from=2026-11-13T23:00:00Z&to=2026-11-14', ['to' => self::INSTANT]];
        yield 'an end without an offset' => ['from=2026-11-13T23:00:00Z&to=2026-11-14T23:00:00', ['to' => self::INSTANT]];
        yield 'an end that is no date' => ['from=2026-11-13T23:00:00Z&to=morgen', ['to' => self::INSTANT]];
        yield 'an end that is a list' => ['from=2026-11-13T23:00:00Z&to[]=2026-11-14T23:00:00Z', ['to' => self::INSTANT]];
        yield 'an end at the start' => ['from=2026-11-13T23:00:00Z&to=2026-11-14T00:00:00%2B01:00', ['to' => 'Zeitpunkt nach from.']];
        yield 'an end before the start' => ['from=2026-11-13T23:00:00Z&to=2026-11-13T22:59:59.999Z', ['to' => 'Zeitpunkt nach from.']];
        yield 'an end without a start' => ['to=2026-11-14T23:00:00Z', ['from' => self::INSTANT]];
        yield 'neither start nor end' => ['', ['from' => self::INSTANT]];
    }

    /**
     * @param array<string, string> $errors
     */
    #[DataProvider('invalidWindows')]
    public function testTheScoreboardAndTheEntryListRejectAnInvalidWindowWithTheSameProblem(string $window, array $errors): void
    {
        $scoreboard = $this->send('GET', "/api/scoreboard?{$window}", session: $this->session);
        $entries = $this->send('GET', "/api/entries?personId=1&{$window}", session: $this->session);

        self::assertSame(422, $scoreboard->getStatusCode(), (string) $scoreboard->getBody());
        self::assertSame('application/problem+json', $scoreboard->getHeaderLine('Content-Type'));
        self::assertSame($errors, $this->body($scoreboard)['errors']);
        self::assertSame([422, (string) $scoreboard->getBody()], [$entries->getStatusCode(), (string) $entries->getBody()]);
    }
}
