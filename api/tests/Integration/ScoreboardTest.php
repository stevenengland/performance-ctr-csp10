<?php

declare(strict_types=1);

namespace Performance\Tests\Integration;

use DateTimeImmutable;
use Performance\Domain\DataRevision;
use Performance\Domain\DrinkStandings;
use Performance\Domain\Scoreboard;
use Performance\Domain\Snapshot;
use Performance\Tests\Support\DatabaseTestCase;
use PHPUnit\Framework\Attributes\DataProvider;
use Psr\Http\Message\ResponseInterface;
use Slim\Psr7\Factory\ServerRequestFactory;

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
        $this->send('POST', '/api/factors', ['name' => 'Happy Hour', 'multiplier' => 2], $this->session);
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
                    'photoUrl' => null,
                    'score' => 7.5,
                    'count' => 6,
                    'pendingCount' => 0,
                    'drinks' => [['drinkId' => 2, 'name' => 'Aperol', 'count' => 1, 'recordedCount' => 1], ['drinkId' => 1, 'name' => 'Bier', 'count' => 5, 'recordedCount' => 5]],
                ],
                ['personId' => 2, 'name' => 'Anna', 'photoUrl' => null, 'score' => 1, 'count' => 1, 'pendingCount' => 0, 'drinks' => [['drinkId' => 1, 'name' => 'Bier', 'count' => 1, 'recordedCount' => 1]]],
            ], 'unranked' => []],
            $this->body($response),
        );
    }

    public function testARecordedEntryWaitsForVerificationAndCountsNeitherInScoreNorCount(): void
    {
        $this->add(1, 1, 2);
        $this->record(1, 1, 3);
        $this->record(1, 2, 1);

        $rows = $this->rowsOf($this->scoreboard());

        self::assertSame([[1, 2, 2]], array_map(static fn(array $row): array => [$row['personId'], $row['score'], $row['count']], $rows));
        self::assertSame([[2, 0], [1, 2]], array_map(static fn(array $drink): array => [$drink['drinkId'], $drink['count']], self::listOf($rows[0]['drinks'])));
    }

    public function testEachDrinkCounterAlsoCountsWhatWasRecordedPendingIncludedWithItsFactor(): void
    {
        $this->add(1, 1, 2);
        $this->record(1, 1, 3, 1);
        $this->record(1, 2, 1);

        $rows = $this->rowsOf($this->scoreboard());

        self::assertSame(
            [
                ['drinkId' => 2, 'name' => 'Aperol', 'count' => 0, 'recordedCount' => 1],
                ['drinkId' => 1, 'name' => 'Bier', 'count' => 2, 'recordedCount' => 8],
            ],
            $rows[0]['drinks'],
        );
    }

    public function testEachRankedPersonCountsTheirPendingEntriesOfTheWindowAsRows(): void
    {
        $this->record(1, 1, 1);
        $this->clock->advance('P1D');
        $this->add(1, 1, 2);
        $this->record(1, 1, 3, 1);
        $this->record(1, 2, 4);
        $this->add(2, 1, 1);

        $rows = $this->rowsOf($this->scoreboard(from: '2026-11-14T23:00:00.000Z'));

        self::assertSame([['Daniel', 2], ['Anna', 0]], array_map(static fn(array $row): array => [$row['name'], $row['pendingCount']], $rows));
    }

    public function testAPersonWhoseEntriesOfTheWindowAllWaitIsListedUnrankedWithTheirCounters(): void
    {
        $this->add(3, 2, 1);
        $this->clock->advance('P1D');
        $this->record(3, 1, 1);
        $this->record(3, 1, 2);
        $this->record(1, 1, 1);
        $this->add(2, 1, 1);

        $board = $this->body($this->scoreboard(from: '2026-11-14T23:00:00.000Z'));

        self::assertSame(['Anna'], array_column(self::listOf($board['rows']), 'name'));
        self::assertSame(
            [
                ['personId' => 3, 'name' => 'Ben', 'photoUrl' => null, 'pendingCount' => 2, 'drinks' => [['drinkId' => 1, 'name' => 'Bier', 'count' => 0, 'recordedCount' => 3]]],
                ['personId' => 1, 'name' => 'Daniel', 'photoUrl' => null, 'pendingCount' => 1, 'drinks' => [['drinkId' => 1, 'name' => 'Bier', 'count' => 0, 'recordedCount' => 1]]],
            ],
            $board['unranked'],
        );
    }

    public function testWithOnlyPendingEntriesNobodyIsRankedSoNobodyLeads(): void
    {
        $this->record(1, 2, 1);

        $board = $this->body($this->scoreboard());

        self::assertSame([], $board['rows']);
        self::assertSame(['Daniel'], array_column(self::listOf($board['unranked']), 'name'));
    }

    public function testTheRevisionAndBothAggregationsReadOneSnapshot(): void
    {
        $this->add(1, 1, 2);
        $reader = $this->otherSession();
        $scoreboard = new Scoreboard($reader, new DataRevision($reader));
        $writer = $this->otherSession();
        $from = new DateTimeImmutable('2026-11-14T00:00:00Z');

        [$revision, $rows] = (new Snapshot($reader))->read(static function () use ($scoreboard, $writer, $from): array {
            $revision = $scoreboard->revision();
            // Another request commits a change between the reads of this one.
            $writer->exec('DELETE FROM entries');
            $writer->exec('UPDATE data_revision SET revision = revision + 1');

            return [$revision, $scoreboard->since($from)->rows];
        });

        self::assertCount(1, $rows, 'the standings belong to the revision that was read');
        self::assertSame(2.0, (float) $rows[0]->count);
        self::assertEquals(new DrinkStandings([], []), $scoreboard->since($from), 'a read after the snapshot sees the change');
        self::assertSame($revision + 1, $scoreboard->revision());
    }

    public function testEntriesBeforeFromAreNotCounted(): void
    {
        $this->add(1, 1, 4);
        $this->clock->advance('PT4H'); // 2026-11-15 00:00 UTC
        $this->add(1, 1, 1);

        $today = $this->body($this->send('GET', '/api/scoreboard?from=2026-11-15T00:00:00Z', session: $this->session));
        $sameInstantWithOffset = $this->body($this->send('GET', '/api/scoreboard?from=' . rawurlencode('2026-11-15T01:00:00+01:00'), session: $this->session));

        self::assertSame([['personId' => 1, 'name' => 'Daniel', 'photoUrl' => null, 'score' => 1, 'count' => 1, 'pendingCount' => 0, 'drinks' => [['drinkId' => 1, 'name' => 'Bier', 'count' => 1, 'recordedCount' => 1]]]], $today['rows']);
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
        yield 'a null byte' => ['?from=2026-11-14T00:00:00Z%00'];
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

    public function testAnUnchangedRevisionAnswers304FromTheRevisionAlone(): void
    {
        $this->add(1, 1, 2);
        $first = $this->scoreboard();
        $tag = $first->getHeaderLine('ETag');
        // Changed behind the API's back, so the revision stays: only a fresh aggregation would see it.
        $this->otherSession()->exec(
            "INSERT INTO entries (id, person_id, drink_id, quantity, account_id, created_at)
             VALUES ('00000000-0000-4000-8000-999999999999', 2, 1, 5, NULL, '2026-11-14 20:00:00.000')",
        );

        $conditional = $this->scoreboard($tag);
        $unconditional = $this->scoreboard();

        self::assertSame(200, $first->getStatusCode());
        self::assertMatchesRegularExpression('/^"[^"]+"$/', $tag);
        self::assertSame(304, $conditional->getStatusCode());
        self::assertSame('', (string) $conditional->getBody());
        self::assertSame($tag, $conditional->getHeaderLine('ETag'));
        self::assertSame(['Anna', 'Daniel'], array_column($this->rowsOf($unconditional), 'name'));
    }

    /**
     * @return iterable<string, array{string}>
     */
    public static function ifNoneMatchForms(): iterable
    {
        yield 'the tag itself' => ['%s'];
        yield 'one of a list' => ['"other", %s'];
        yield 'as compressed by Apache' => ['%s-gzip'];
        yield 'any' => ['*'];
    }

    #[DataProvider('ifNoneMatchForms')]
    public function testIfNoneMatchAcceptsTheUsualForms(string $form): void
    {
        $tag = $this->scoreboard()->getHeaderLine('ETag');
        $header = str_contains($form, '-gzip') ? substr($tag, 0, -1) . '-gzip"' : sprintf($form, $tag);

        self::assertSame(304, $this->scoreboard($header)->getStatusCode());
    }

    public function testAnotherDayWindowIsNotAnswered304WithTheSameRevision(): void
    {
        $tag = $this->scoreboard()->getHeaderLine('ETag');

        $nextDay = $this->scoreboard($tag, '2026-11-15T23:00:00.000Z');

        self::assertSame(200, $nextDay->getStatusCode());
        self::assertNotSame($tag, $nextDay->getHeaderLine('ETag'));
    }

    /**
     * Each write that changes the standings, sent as the API's client sends it.
     *
     * @return iterable<string, array{string, string, array<string, mixed>|null}>
     */
    public static function writes(): iterable
    {
        yield 'a new person' => ['POST', '/api/persons', ['name' => 'Jule']];
        yield 'a new drink' => ['POST', '/api/drinks', ['name' => 'Wein', 'points' => 2]];
        yield 'a new entry' => ['PUT', '/api/entries/00000000-0000-4000-8000-000000000777', ['personId' => 1, 'drinkId' => 1, 'quantity' => 1]];
        yield 'an undone entry' => ['DELETE', '/api/entries/00000000-0000-4000-8000-000000000001', null];
        yield 'a new factor' => ['POST', '/api/factors', ['name' => 'Geburtstag', 'multiplier' => 1.5]];
        yield 'an edited factor' => ['PATCH', '/api/factors/1', ['name' => 'Happy Hour', 'multiplier' => 3]];
        yield 'a deleted factor' => ['DELETE', '/api/factors/1', null];
        yield 'a renamed person' => ['PATCH', '/api/persons/1', ['name' => 'Dani']];
        yield 'a deleted person' => ['DELETE', '/api/persons/1', null];
        yield 'an edited drink' => ['PATCH', '/api/drinks/1', ['name' => 'Bier', 'points' => 2]];
        yield 'a deleted drink' => ['DELETE', '/api/drinks/1', null];
    }

    /**
     * @param array<string, mixed>|null $json
     */
    #[DataProvider('writes')]
    public function testEveryWriteBumpsTheRevision(string $method, string $path, ?array $json): void
    {
        $this->add(1, 1, 1);
        $tag = $this->scoreboard()->getHeaderLine('ETag');

        $write = $this->send($method, $path, $json, $this->session);

        self::assertLessThan(300, $write->getStatusCode(), (string) $write->getBody());
        self::assertSame(200, $this->scoreboard($tag)->getStatusCode());
    }

    /**
     * Writes that fail after their change began: the revision bump rolls back with them.
     *
     * @return iterable<string, array{string, string, array<string, mixed>|null}>
     */
    public static function failedWrites(): iterable
    {
        yield 'a taken person name' => ['POST', '/api/persons', ['name' => 'daniel']];
        yield 'a taken drink name' => ['POST', '/api/drinks', ['name' => 'BIER', 'points' => 2]];
        yield 'an entry for nobody' => ['PUT', '/api/entries/00000000-0000-4000-8000-000000000777', ['personId' => 99, 'drinkId' => 1, 'quantity' => 1]];
        yield 'a replayed entry' => ['PUT', '/api/entries/00000000-0000-4000-8000-000000000001', ['personId' => 1, 'drinkId' => 1, 'quantity' => 1]];
        yield 'an unknown entry' => ['DELETE', '/api/entries/00000000-0000-4000-8000-000000000555', null];
        yield 'a taken factor name' => ['POST', '/api/factors', ['name' => 'happy hour', 'multiplier' => 3]];
        yield 'an unknown factor' => ['PATCH', '/api/factors/9', ['name' => 'Geburtstag', 'multiplier' => 3]];
        yield 'a deleted unknown factor' => ['DELETE', '/api/factors/9', null];
        yield 'an unknown person' => ['PATCH', '/api/persons/9', ['name' => 'Jule']];
        yield 'a deleted unknown person' => ['DELETE', '/api/persons/9', null];
        yield 'an invalid person name' => ['PATCH', '/api/persons/1', ['name' => '']];
        yield 'a rename to a taken person name' => ['PATCH', '/api/persons/1', ['name' => 'anna']];
        yield 'a rename to a taken drink name' => ['PATCH', '/api/drinks/1', ['name' => 'APEROL', 'points' => 1]];
        yield 'an unknown drink' => ['PATCH', '/api/drinks/9', ['name' => 'Wein', 'points' => 2]];
        yield 'a deleted unknown drink' => ['DELETE', '/api/drinks/9', null];
        yield 'an entry with an unknown factor' => ['PUT', '/api/entries/00000000-0000-4000-8000-000000000777', ['personId' => 1, 'drinkId' => 1, 'quantity' => 1, 'factorId' => 9]];
    }

    /**
     * @param array<string, mixed>|null $json
     */
    #[DataProvider('failedWrites')]
    public function testAWriteThatChangesNothingLeavesTheRevision(string $method, string $path, ?array $json): void
    {
        $this->add(1, 1, 1);
        $tag = $this->scoreboard()->getHeaderLine('ETag');

        $this->send($method, $path, $json, $this->session);

        self::assertSame(304, $this->scoreboard($tag)->getStatusCode());
    }

    private function scoreboard(?string $ifNoneMatch = null, string $from = '2026-11-13T23:00:00.000Z'): ResponseInterface
    {
        $request = (new ServerRequestFactory())
            ->createServerRequest('GET', '/api/scoreboard?from=' . rawurlencode($from))
            ->withCookieParams(['session' => $this->session]);
        if ($ifNoneMatch !== null) {
            $request = $request->withHeader('If-None-Match', $ifNoneMatch);
        }

        return $this->app()->handle($request);
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function rowsOf(ResponseInterface $response): array
    {
        $rows = $this->body($response)['rows'];
        self::assertIsArray($rows);

        /** @var list<array<string, mixed>> $rows */
        return $rows;
    }

    /** Records an entry and lets it count. */
    /**
     * @return list<array<string, mixed>>
     */
    private static function listOf(mixed $list): array
    {
        self::assertIsList($list);

        /** @var list<array<string, mixed>> */
        return $list;
    }

    private function add(int $personId, int $drinkId, int $quantity, ?int $factorId = null): string
    {
        $id = $this->record($personId, $drinkId, $quantity, $factorId);
        $this->verifyDirectly('entries', $id);

        return $id;
    }

    /** Records an entry, which waits for verification. */
    private function record(int $personId, int $drinkId, int $quantity, ?int $factorId = null): string
    {
        ++$this->entries;
        $id = sprintf('00000000-0000-4000-8000-%012d', $this->entries);
        $response = $this->send('PUT', "/api/entries/{$id}", ['personId' => $personId, 'drinkId' => $drinkId, 'quantity' => $quantity, 'factorId' => $factorId], $this->session);
        self::assertSame(201, $response->getStatusCode(), (string) $response->getBody());

        return $id;
    }
}
