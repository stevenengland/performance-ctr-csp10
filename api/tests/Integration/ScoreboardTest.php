<?php

declare(strict_types=1);

namespace Performance\Tests\Integration;

use Performance\Tests\Support\DatabaseTestCase;
use PHPUnit\Framework\Attributes\DataProvider;

final class ScoreboardTest extends DatabaseTestCase
{
    private string $session;
    private int $entries = 0;

    protected function setUp(): void
    {
        parent::setUp();
        $this->session = $this->signIn();
        foreach (['Daniel', 'Anna', 'Ben'] as $name) {
            $this->send('POST', '/api/persons', ['name' => $name], $this->session);
        }
        $this->send('POST', '/api/drinks', ['name' => 'Bier', 'points' => 1], $this->session);
        $this->send('POST', '/api/drinks', ['name' => 'Aperol', 'points' => 2.5], $this->session);
    }

    public function testCountsEachPersonsDrinksAndScoreSinceFromAndRanksByScore(): void
    {
        // 2026-11-14 20:00 UTC; "today" in Berlin started at 2026-11-13 23:00 UTC.
        $this->add(1, 1, 2);
        $this->add(1, 2, 1);
        $this->add(2, 1, 1);
        $this->add(1, 1, 3);

        $response = $this->send('GET', '/api/scoreboard?from=2026-11-13T23:00:00.000Z', session: $this->session);

        self::assertSame(200, $response->getStatusCode(), (string) $response->getBody());
        self::assertSame(
            ['rows' => [
                [
                    'personId' => 1,
                    'name' => 'Daniel',
                    'score' => 7.5,
                    'count' => 6,
                    'drinks' => [['drinkId' => 2, 'name' => 'Aperol', 'count' => 1], ['drinkId' => 1, 'name' => 'Bier', 'count' => 5]],
                ],
                ['personId' => 2, 'name' => 'Anna', 'score' => 1, 'count' => 1, 'drinks' => [['drinkId' => 1, 'name' => 'Bier', 'count' => 1]]],
            ]],
            $this->body($response),
        );
    }

    public function testEntriesBeforeFromAreNotCounted(): void
    {
        $this->add(1, 1, 4);
        $this->clock->advance('PT4H'); // 2026-11-15 00:00 UTC
        $this->add(1, 1, 1);

        $today = $this->body($this->send('GET', '/api/scoreboard?from=2026-11-15T00:00:00Z', session: $this->session));
        $sameInstantWithOffset = $this->body($this->send('GET', '/api/scoreboard?from=' . rawurlencode('2026-11-15T01:00:00+01:00'), session: $this->session));

        self::assertSame([['personId' => 1, 'name' => 'Daniel', 'score' => 1, 'count' => 1, 'drinks' => [['drinkId' => 1, 'name' => 'Bier', 'count' => 1]]]], $today['rows']);
        self::assertSame($today, $sameInstantWithOffset);
    }

    public function testTiesAreRankedByNameAndUndoneEntriesDisappear(): void
    {
        $this->add(3, 1, 2);
        $this->add(2, 1, 2);
        $undone = $this->add(1, 1, 9);
        $this->send('DELETE', "/api/entries/{$undone}", session: $this->session);

        $rows = $this->body($this->send('GET', '/api/scoreboard?from=2026-11-14T00:00:00Z', session: $this->session))['rows'];

        self::assertIsArray($rows);
        self::assertSame(['Anna', 'Ben'], array_column($rows, 'name'));
    }

    /**
     * @return iterable<string, array{string}>
     */
    public static function invalidFroms(): iterable
    {
        yield 'missing' => [''];
        yield 'a date only' => ['?from=2026-11-14'];
        yield 'no time zone' => ['?from=2026-11-14T00:00:00'];
        yield 'not a date' => ['?from=gestern'];
        yield 'an impossible date' => ['?from=2026-13-45T00:00:00Z'];
    }

    #[DataProvider('invalidFroms')]
    public function testFromMustBeAnIso8601Instant(string $query): void
    {
        $response = $this->send('GET', "/api/scoreboard{$query}", session: $this->session);

        self::assertSame(422, $response->getStatusCode());
        self::assertSame(['from' => 'Zeitpunkt nach ISO 8601 mit Zeitzone.'], $this->body($response)['errors']);
    }

    public function testTheScoreboardNeedsASession(): void
    {
        self::assertSame(401, $this->send('GET', '/api/scoreboard?from=2026-11-14T00:00:00Z')->getStatusCode());
    }

    private function add(int $personId, int $drinkId, int $quantity): string
    {
        ++$this->entries;
        $id = sprintf('00000000-0000-4000-8000-%012d', $this->entries);
        $response = $this->send('PUT', "/api/entries/{$id}", ['personId' => $personId, 'drinkId' => $drinkId, 'quantity' => $quantity], $this->session);
        self::assertSame(201, $response->getStatusCode(), (string) $response->getBody());

        return $id;
    }
}
