<?php

declare(strict_types=1);

namespace Performance\Tests\Integration;

use Performance\Tests\Support\DatabaseTestCase;
use PHPUnit\Framework\Attributes\DataProvider;

/**
 * Every windowed read takes `from` and an optional `to` alike, and every read that offers all
 * time takes `scope=all` alike: the same selection is rejected by each with the same problem.
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
        $this->send('POST', '/api/games', ['name' => 'Schach', 'kind' => 'duel'], $this->session);
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

    /**
     * Every invalid window but the empty query, which names the current run there, and every
     * invalid scope.
     *
     * @return iterable<string, array{string, array<string, string>}>
     */
    public static function invalidSelections(): iterable
    {
        foreach (self::invalidWindows() as $name => $case) {
            if ($case[0] !== '') {
                yield $name => $case;
            }
        }
        yield from ScoreboardTest::invalidScopes();
    }

    /**
     * @param array<string, string> $errors
     */
    #[DataProvider('invalidSelections')]
    public function testAGamesStandingsRejectAnInvalidWindowOrScopeWithTheScoreboardsProblem(string $selection, array $errors): void
    {
        $scoreboard = $this->send('GET', "/api/scoreboard?{$selection}", session: $this->session);
        $standings = $this->send('GET', "/api/games/1/standings?{$selection}", session: $this->session);

        self::assertSame($errors, $this->body($scoreboard)['errors']);
        self::assertSame([422, (string) $scoreboard->getBody()], [$standings->getStatusCode(), (string) $standings->getBody()]);
    }

    /**
     * Every invalid window, the empty query included (a days read has no default), and every
     * invalid scope.
     *
     * @return iterable<string, array{string, array<string, string>}>
     */
    public static function invalidWindowsAndScopes(): iterable
    {
        yield from self::invalidWindows();
        yield from ScoreboardTest::invalidScopes();
    }

    /**
     * @param array<string, string> $errors
     */
    #[DataProvider('invalidWindowsAndScopes')]
    public function testTheDaysReadsRejectAnInvalidWindowOrScopeWithTheScoreboardsProblem(string $selection, array $errors): void
    {
        $scoreboard = $this->send('GET', "/api/scoreboard?{$selection}", session: $this->session);
        $drinks = $this->send('GET', "/api/scoreboard/days?{$selection}", session: $this->session);
        $game = $this->send('GET', "/api/games/1/standings/days?{$selection}", session: $this->session);

        self::assertSame($errors, $this->body($scoreboard)['errors']);
        self::assertSame([422, (string) $scoreboard->getBody()], [$drinks->getStatusCode(), (string) $drinks->getBody()]);
        self::assertSame([422, (string) $scoreboard->getBody()], [$game->getStatusCode(), (string) $game->getBody()]);
    }

    /**
     * @return iterable<string, array{string, array<string, string>}>
     */
    public static function unboundedWindows(): iterable
    {
        yield 'a start without an end' => ['from=2026-11-01T00:00:00%2B01:00', ['to' => self::INSTANT]];
        yield 'an end a millisecond more than 35 days after the start' => [
            'from=2026-11-01T00:00:00%2B01:00&to=2026-12-06T00:00:00.001%2B01:00',
            ['to' => 'Höchstens 35 Tage nach from.'],
        ];
        yield 'a year' => ['from=2026-01-01T00:00:00Z&to=2027-01-01T00:00:00Z', ['to' => 'Höchstens 35 Tage nach from.']];
    }

    /**
     * A days read reads a bounded window: the calendar's month, with a margin. An unknown game
     * is not looked up for a window it rejects.
     *
     * @param array<string, string> $errors
     */
    #[DataProvider('unboundedWindows')]
    public function testTheDaysReadsRejectAWindowWithoutAnEndOrLongerThan35Days(string $window, array $errors): void
    {
        $drinks = $this->send('GET', "/api/scoreboard/days?{$window}", session: $this->session);
        $game = $this->send('GET', "/api/games/9/standings/days?{$window}", session: $this->session);

        self::assertSame(422, $drinks->getStatusCode(), (string) $drinks->getBody());
        self::assertSame($errors, $this->body($drinks)['errors']);
        self::assertSame([422, (string) $drinks->getBody()], [$game->getStatusCode(), (string) $game->getBody()]);
    }

    public function testTheDaysReadsTakeAWindowOfExactly35Days(): void
    {
        $window = 'from=2026-11-01T00:00:00%2B01:00&to=2026-12-06T00:00:00%2B01:00';

        $drinks = $this->send('GET', "/api/scoreboard/days?{$window}", session: $this->session);
        $game = $this->send('GET', "/api/games/1/standings/days?{$window}", session: $this->session);

        self::assertSame([200, ['spans' => []]], [$drinks->getStatusCode(), $this->body($drinks)]);
        self::assertSame([200, ['spans' => []]], [$game->getStatusCode(), $this->body($game)]);
    }
}
