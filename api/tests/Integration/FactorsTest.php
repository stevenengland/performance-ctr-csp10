<?php

declare(strict_types=1);

namespace Performance\Tests\Integration;

use Performance\Tests\Support\DatabaseTestCase;
use PHPUnit\Framework\Attributes\DataProvider;
use Psr\Http\Message\ResponseInterface;

final class FactorsTest extends DatabaseTestCase
{
    private string $session;
    private int $entries = 0;

    protected function setUp(): void
    {
        parent::setUp();
        $this->session = $this->signIn();
    }

    public function testCreatesAFactorWithATrimmedNameAndListsFactorsAlphabetically(): void
    {
        $created = $this->send('POST', '/api/factors', ['name' => '  Happy Hour ', 'multiplier' => 2], $this->session);
        $this->send('POST', '/api/factors', ['name' => 'geburtstag', 'multiplier' => 1.5], $this->session);
        $this->send('POST', '/api/factors', ['name' => 'Zapfenstreich', 'multiplier' => 0.5], $this->session);

        self::assertSame(201, $created->getStatusCode(), (string) $created->getBody());
        self::assertSame(['id' => 1, 'name' => 'Happy Hour', 'multiplier' => 2], $this->body($created));
        $list = $this->send('GET', '/api/factors', session: $this->session);
        self::assertSame(200, $list->getStatusCode());
        self::assertSame(
            [
                ['id' => 2, 'name' => 'geburtstag', 'multiplier' => 1.5],
                ['id' => 1, 'name' => 'Happy Hour', 'multiplier' => 2],
                ['id' => 3, 'name' => 'Zapfenstreich', 'multiplier' => 0.5],
            ],
            $this->body($list)['factors'],
        );
    }

    public function testAMultiplierFromJustAbove0To99Point99IsAccepted(): void
    {
        $smallest = $this->send('POST', '/api/factors', ['name' => 'Kaum', 'multiplier' => 0.01], $this->session);
        $largest = $this->send('POST', '/api/factors', ['name' => 'Riesig', 'multiplier' => 99.99], $this->session);

        self::assertSame(['id' => 1, 'name' => 'Kaum', 'multiplier' => 0.01], $this->body($smallest));
        self::assertSame(['id' => 2, 'name' => 'Riesig', 'multiplier' => 99.99], $this->body($largest));
    }

    /**
     * @return iterable<string, array{mixed}>
     */
    public static function invalidMultipliers(): iterable
    {
        yield 'zero' => [0];
        yield 'negative' => [-1];
        yield 'above 99.99' => [100];
        yield 'three decimals' => [1.005];
        yield 'text with a decimal comma' => ['1,5'];
        yield 'missing' => [null];
    }

    #[DataProvider('invalidMultipliers')]
    public function testAMultiplierOutside0To99Point99Is422(mixed $multiplier): void
    {
        $response = $this->send(
            'POST',
            '/api/factors',
            $multiplier === null ? ['name' => 'Happy Hour'] : ['name' => 'Happy Hour', 'multiplier' => $multiplier],
            $this->session,
        );

        self::assertSame(422, $response->getStatusCode());
        self::assertSame(['multiplier' => 'Zahl über 0 bis 99,99.'], $this->body($response)['errors']);
        self::assertSame([], $this->rows('SELECT id FROM factors'));
    }

    public function testANameOutside1To40CharactersIs422(): void
    {
        $empty = $this->send('POST', '/api/factors', ['name' => '  ', 'multiplier' => 2], $this->session);
        $long = $this->send('POST', '/api/factors', ['name' => str_repeat('x', 41), 'multiplier' => 2], $this->session);

        foreach ([$empty, $long] as $response) {
            self::assertSame(422, $response->getStatusCode());
            self::assertSame(['name' => '1 bis 40 Zeichen.'], $this->body($response)['errors']);
        }
    }

    public function testANameThatDiffersOnlyInCaseIs409(): void
    {
        $this->send('POST', '/api/factors', ['name' => 'Happy Hour', 'multiplier' => 2], $this->session);

        $response = $this->send('POST', '/api/factors', ['name' => 'HAPPY hour', 'multiplier' => 3], $this->session);

        self::assertSame(409, $response->getStatusCode());
        self::assertSame('urn:performance:problem:duplicate-name', $this->body($response)['type']);
        self::assertSame([['multiplier' => '2.00']], $this->rows('SELECT multiplier FROM factors'));
    }

    public function testEditsAFactorsNameAndMultiplier(): void
    {
        $this->send('POST', '/api/factors', ['name' => 'Happy Hour', 'multiplier' => 2], $this->session);

        $response = $this->send('PATCH', '/api/factors/1', ['name' => ' Happy Hour XL ', 'multiplier' => 3.5], $this->session);

        self::assertSame(200, $response->getStatusCode(), (string) $response->getBody());
        self::assertSame(['id' => 1, 'name' => 'Happy Hour XL', 'multiplier' => 3.5], $this->body($response));
        self::assertSame(
            [['id' => 1, 'name' => 'Happy Hour XL', 'multiplier' => 3.5]],
            $this->body($this->send('GET', '/api/factors', session: $this->session))['factors'],
        );
    }

    public function testEditingKeepsItsOwnNameInAnotherCaseButRefusesAnothersName(): void
    {
        $this->send('POST', '/api/factors', ['name' => 'Happy Hour', 'multiplier' => 2], $this->session);
        $this->send('POST', '/api/factors', ['name' => 'Geburtstag', 'multiplier' => 1.5], $this->session);

        $ownName = $this->send('PATCH', '/api/factors/1', ['name' => 'HAPPY HOUR', 'multiplier' => 2], $this->session);
        $taken = $this->send('PATCH', '/api/factors/1', ['name' => 'geburtstag', 'multiplier' => 2], $this->session);

        self::assertSame(200, $ownName->getStatusCode());
        self::assertSame(409, $taken->getStatusCode());
        self::assertSame('urn:performance:problem:duplicate-name', $this->body($taken)['type']);
    }

    public function testEditingValidatesLikeCreating(): void
    {
        $this->send('POST', '/api/factors', ['name' => 'Happy Hour', 'multiplier' => 2], $this->session);

        $response = $this->send('PATCH', '/api/factors/1', ['name' => '', 'multiplier' => 0], $this->session);

        self::assertSame(422, $response->getStatusCode());
        self::assertSame(['name' => '1 bis 40 Zeichen.', 'multiplier' => 'Zahl über 0 bis 99,99.'], $this->body($response)['errors']);
    }

    public function testReadsAFactorWithItsEntryCount(): void
    {
        $this->send('POST', '/api/factors', ['name' => 'Happy Hour', 'multiplier' => 2], $this->session);

        $response = $this->send('GET', '/api/factors/1', session: $this->session);

        self::assertSame(200, $response->getStatusCode());
        self::assertSame(['id' => 1, 'name' => 'Happy Hour', 'multiplier' => 2, 'entryCount' => 0], $this->body($response));
    }

    public function testDeletesAFactor(): void
    {
        $this->send('POST', '/api/factors', ['name' => 'Happy Hour', 'multiplier' => 2], $this->session);

        $response = $this->send('DELETE', '/api/factors/1', session: $this->session);

        self::assertSame(204, $response->getStatusCode());
        self::assertSame([], $this->body($this->send('GET', '/api/factors', session: $this->session))['factors']);
    }

    public function testAnUnknownFactorIs404(): void
    {
        foreach ([
            $this->send('GET', '/api/factors/7', session: $this->session),
            $this->send('PATCH', '/api/factors/7', ['name' => 'Happy Hour', 'multiplier' => 2], $this->session),
            $this->send('DELETE', '/api/factors/7', session: $this->session),
            $this->send('GET', '/api/factors/abc', session: $this->session),
        ] as $response) {
            self::assertSame(404, $response->getStatusCode());
            self::assertSame('urn:performance:problem:not-found', $this->body($response)['type']);
        }
    }

    public function testAFactorMultipliesTheDrinkCounterAndTheScoreOfItsEntry(): void
    {
        $this->evening();
        $this->send('POST', '/api/factors', ['name' => 'Happy Hour', 'multiplier' => 2], $this->session);

        $saved = $this->add(1, 1, 2, factorId: 1);
        $this->add(1, 1, 1);

        self::assertSame(201, $saved->getStatusCode(), (string) $saved->getBody());
        self::assertSame(1, $this->body($saved)['factorId']);
        self::assertSame(
            [['personId' => 1, 'name' => 'Daniel', 'photoUrl' => null, 'score' => 7.5, 'count' => 5, 'rawCount' => 3, 'pendingCount' => 0, 'drinks' => [['drinkId' => 1, 'name' => 'Bier', 'count' => 5, 'recordedCount' => 5, 'rawCount' => 3, 'rawRecordedCount' => 3]]]],
            $this->standings(),
        );
    }

    public function testNoFactorCountsOnce(): void
    {
        $this->evening();
        $this->send('POST', '/api/factors', ['name' => 'Happy Hour', 'multiplier' => 2], $this->session);

        $saved = $this->add(1, 1, 2, factorId: null);

        self::assertNull($this->body($saved)['factorId']);
        self::assertSame(3, $this->standings()[0]['score']);
        self::assertSame(2, $this->standings()[0]['count']);
    }

    public function testDecimalMultipliersAndPointsAreExact(): void
    {
        $this->evening(points: 1.5);
        $this->send('POST', '/api/factors', ['name' => 'Geburtstag', 'multiplier' => 1.5], $this->session);

        $this->add(1, 1, 3, factorId: 1);

        self::assertSame(6.75, $this->standings()[0]['score']);
        self::assertSame(4.5, $this->standings()[0]['count']);
    }

    public function testEditingAMultiplierChangesTodaysScoresOfItsEntries(): void
    {
        $this->evening();
        $this->send('POST', '/api/factors', ['name' => 'Happy Hour', 'multiplier' => 2], $this->session);
        $this->add(1, 1, 2, factorId: 1);

        $this->send('PATCH', '/api/factors/1', ['name' => 'Happy Hour', 'multiplier' => 3], $this->session);

        self::assertSame(9, $this->standings()[0]['score']);
        self::assertSame(6, $this->standings()[0]['count']);
    }

    public function testDeletingAFactorKeepsItsEntriesWhichThenCountOnce(): void
    {
        $this->evening();
        $this->send('POST', '/api/factors', ['name' => 'Happy Hour', 'multiplier' => 2], $this->session);
        $this->add(1, 1, 2, factorId: 1);
        $this->add(1, 1, 1, factorId: 1);
        $this->add(1, 1, 1);
        self::assertSame(2, $this->body($this->send('GET', '/api/factors/1', session: $this->session))['entryCount']);

        $deleted = $this->send('DELETE', '/api/factors/1', session: $this->session);

        self::assertSame(204, $deleted->getStatusCode());
        self::assertSame([['factor_id' => null], ['factor_id' => null], ['factor_id' => null]], $this->rows('SELECT factor_id FROM entries'));
        self::assertSame(6, $this->standings()[0]['score']);
        self::assertSame(4, $this->standings()[0]['count']);
    }

    public function testFactorsNeedASession(): void
    {
        self::assertSame(401, $this->send('GET', '/api/factors')->getStatusCode());
        self::assertSame(401, $this->send('POST', '/api/factors', ['name' => 'Happy Hour', 'multiplier' => 2])->getStatusCode());
        self::assertSame(401, $this->send('GET', '/api/factors/1')->getStatusCode());
        self::assertSame(401, $this->send('PATCH', '/api/factors/1', ['name' => 'Happy Hour', 'multiplier' => 2])->getStatusCode());
        self::assertSame(401, $this->send('DELETE', '/api/factors/1')->getStatusCode());
    }

    /** Daniel and a beer worth the given points. */
    private function evening(int|float $points = 1.5): void
    {
        $this->send('POST', '/api/persons', ['name' => 'Daniel'], $this->session);
        $this->send('POST', '/api/drinks', ['name' => 'Bier', 'points' => $points], $this->session);
    }

    /** Records an entry and, once it is recorded, lets it count. */
    private function add(int $personId, int $drinkId, int $quantity, ?int $factorId = null): ResponseInterface
    {
        ++$this->entries;
        $id = sprintf('00000000-0000-4000-8000-%012d', $this->entries);

        $response = $this->send(
            'PUT',
            "/api/entries/{$id}",
            ['personId' => $personId, 'drinkId' => $drinkId, 'quantity' => $quantity, 'factorId' => $factorId],
            $this->session,
        );
        if ($response->getStatusCode() === 201) {
            $this->verifyDirectly('entries', $id);
        }

        return $response;
    }

    /**
     * Today's standings (the clock stands at 2026-11-14 20:00 UTC).
     *
     * @return list<array<string, mixed>>
     */
    private function standings(): array
    {
        $rows = $this->body($this->send('GET', '/api/scoreboard?from=2026-11-14T00:00:00Z', session: $this->session))['rows'];
        self::assertIsArray($rows);

        /** @var list<array<string, mixed>> $rows */
        return $rows;
    }
}
