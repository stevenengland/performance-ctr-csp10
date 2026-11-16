<?php

declare(strict_types=1);

namespace Performance\Tests\Integration;

use Performance\Tests\Support\DatabaseTestCase;
use PHPUnit\Framework\Attributes\DataProvider;
use Psr\Http\Message\ResponseInterface;

final class EntryHistoryTest extends DatabaseTestCase
{
    /** Local midnight of 2026-11-15 in Berlin. */
    private const FROM = '2026-11-14T23:00:00.000Z';
    private const BEFORE = '0b8f5e3a-1c2d-4e5f-9a0b-1c2d3e4f5a6b';
    private const FIRST = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
    private const SECOND = '6f1c2d3e-4a5b-4c6d-8e7f-90a1b2c3d4e5';
    private const OTHER_PERSON = '9e8d7c6b-5a4f-4e3d-a2c1-b0a9f8e7d6c5';

    private string $session;

    protected function setUp(): void
    {
        parent::setUp();
        $this->session = $this->signIn();
        $this->send('POST', '/api/persons', ['name' => 'Daniel'], $this->session);
        $this->send('POST', '/api/persons', ['name' => 'Anna'], $this->session);
        $this->send('POST', '/api/drinks', ['name' => 'Bier', 'points' => 1], $this->session);
        $this->send('POST', '/api/drinks', ['name' => 'Margarita', 'points' => 3], $this->session);
        $this->send('POST', '/api/factors', ['name' => 'Happy Hour', 'multiplier' => 2], $this->session);
    }

    public function testListsAPersonsEntriesSinceFromNewestFirstWithDrinkQuantityFactorTimeAndAccount(): void
    {
        $this->createAccount('anna', 'annas-startpasswort');
        $anna = $this->signIn('anna', 'annas-startpasswort');
        $this->clock->advance('PT2H'); // 22:00 UTC, the evening before
        $this->add(self::BEFORE, ['personId' => 1, 'drinkId' => 1, 'quantity' => 1]);
        $this->clock->advance('PT1H30M'); // 23:30 UTC
        $this->add(self::FIRST, ['personId' => 1, 'drinkId' => 2, 'quantity' => 1]);
        $this->add(self::OTHER_PERSON, ['personId' => 2, 'drinkId' => 1, 'quantity' => 3]);
        $this->clock->advance('PT11M'); // 23:41 UTC
        $this->add(self::SECOND, ['personId' => 1, 'drinkId' => 1, 'quantity' => 2, 'factorId' => 1], $anna);

        $response = $this->history('personId=1&from=' . self::FROM);

        self::assertSame(200, $response->getStatusCode(), (string) $response->getBody());
        self::assertSame(['entries' => [
            [
                'id' => self::SECOND,
                'drink' => ['id' => 1, 'name' => 'Bier'],
                'quantity' => 2,
                'factor' => ['id' => 1, 'name' => 'Happy Hour', 'multiplier' => 2],
                'createdAt' => '2026-11-14T23:41:00.000Z',
                'accountName' => 'anna',
            ],
            [
                'id' => self::FIRST,
                'drink' => ['id' => 2, 'name' => 'Margarita'],
                'quantity' => 1,
                'factor' => null,
                'createdAt' => '2026-11-14T23:30:00.000Z',
                'accountName' => self::ADMIN,
            ],
        ]], $this->body($response));
    }

    public function testFromMayCarryAnyOffsetAndIncludesAnEntryAtExactlyThatInstant(): void
    {
        $this->clock->advance('PT3H'); // 23:00 UTC = 00:00 in Berlin
        $this->add(self::FIRST, ['personId' => 1, 'drinkId' => 1, 'quantity' => 1]);

        $response = $this->history('personId=1&from=' . rawurlencode('2026-11-15T00:00:00+01:00'));

        self::assertSame([self::FIRST], array_column($this->entries($response), 'id'));
    }

    public function testAnEntryOfADeletedAccountHasNoAccountName(): void
    {
        $this->createAccount('ben', 'bens-startpasswort');
        $ben = $this->signIn('ben', 'bens-startpasswort');
        $this->clock->advance('PT4H');
        $this->add(self::FIRST, ['personId' => 1, 'drinkId' => 1, 'quantity' => 1], $ben);
        $this->otherSession()->exec("DELETE FROM accounts WHERE user_name = 'ben'");

        $response = $this->history('personId=1&from=' . self::FROM);

        self::assertSame(200, $response->getStatusCode(), (string) $response->getBody());
        self::assertNull($this->entries($response)[0]['accountName']);
    }

    public function testAnEntryOfADeletedFactorHasNoFactor(): void
    {
        $this->clock->advance('PT4H');
        $this->add(self::FIRST, ['personId' => 1, 'drinkId' => 1, 'quantity' => 2, 'factorId' => 1]);
        $this->send('DELETE', '/api/factors/1', session: $this->session);

        $response = $this->history('personId=1&from=' . self::FROM);

        self::assertNull($this->entries($response)[0]['factor']);
    }

    public function testADecimalMultiplierIsANumberRoundedToTwoPlaces(): void
    {
        $this->send('POST', '/api/factors', ['name' => 'Geburtstag', 'multiplier' => 1.5], $this->session);
        $this->clock->advance('PT4H');
        $this->add(self::FIRST, ['personId' => 1, 'drinkId' => 1, 'quantity' => 1, 'factorId' => 2]);

        $response = $this->history('personId=1&from=' . self::FROM);

        self::assertSame(['id' => 2, 'name' => 'Geburtstag', 'multiplier' => 1.5], $this->entries($response)[0]['factor']);
    }

    public function testAPersonWithoutEntriesSinceFromHasAnEmptyList(): void
    {
        $this->add(self::BEFORE, ['personId' => 1, 'drinkId' => 1, 'quantity' => 1]);

        $response = $this->history('personId=1&from=' . self::FROM);

        self::assertSame(200, $response->getStatusCode());
        self::assertSame(['entries' => []], $this->body($response));
    }

    public function testADeletedEntryIsGoneAndALateReplayOfItsPutDoesNotBringItBack(): void
    {
        $this->clock->advance('PT4H');
        $request = ['personId' => 1, 'drinkId' => 1, 'quantity' => 2];
        $this->add(self::FIRST, $request);
        $this->add(self::SECOND, ['personId' => 1, 'drinkId' => 2, 'quantity' => 1]);

        $deleted = $this->send('DELETE', '/api/entries/' . self::FIRST, session: $this->session);
        $this->clock->advance('PT1H');
        $replay = $this->send('PUT', '/api/entries/' . self::FIRST, $request, $this->session);

        self::assertSame(204, $deleted->getStatusCode());
        self::assertSame(200, $replay->getStatusCode(), (string) $replay->getBody());
        self::assertSame([self::SECOND], array_column($this->entries($this->history('personId=1&from=' . self::FROM)), 'id'));
    }

    /**
     * @return iterable<string, array{string}>
     */
    public static function malformedInstants(): iterable
    {
        yield 'missing' => ['personId=1'];
        yield 'empty' => ['personId=1&from='];
        yield 'date only' => ['personId=1&from=2026-11-14'];
        yield 'no offset' => ['personId=1&from=2026-11-14T23:00:00'];
        yield 'not a date' => ['personId=1&from=gestern'];
        yield 'impossible date' => ['personId=1&from=2026-02-30T23:00:00Z'];
        yield 'list' => ['personId=1&from[]=' . self::FROM];
    }

    #[DataProvider('malformedInstants')]
    public function testAMalformedFromIs422(string $query): void
    {
        $response = $this->history($query);

        self::assertSame(422, $response->getStatusCode(), (string) $response->getBody());
        self::assertSame('application/problem+json', $response->getHeaderLine('Content-Type'));
        self::assertSame(['from' => 'Zeitpunkt nach ISO 8601 mit Zeitzone.'], $this->body($response)['errors']);
    }

    /**
     * @return iterable<string, array{string}>
     */
    public static function malformedPersonIds(): iterable
    {
        yield 'missing' => ['from=' . self::FROM];
        yield 'zero' => ['personId=0&from=' . self::FROM];
        yield 'negative' => ['personId=-1&from=' . self::FROM];
        yield 'text' => ['personId=abc&from=' . self::FROM];
        yield 'fraction' => ['personId=1.5&from=' . self::FROM];
    }

    #[DataProvider('malformedPersonIds')]
    public function testAMalformedPersonIdIs422(string $query): void
    {
        $response = $this->history($query);

        self::assertSame(422, $response->getStatusCode(), (string) $response->getBody());
        self::assertSame(['personId' => 'Person nicht gefunden.'], $this->body($response)['errors']);
    }

    public function testAnUnknownPersonIs404(): void
    {
        $response = $this->history('personId=99&from=' . self::FROM);

        self::assertSame(404, $response->getStatusCode());
        self::assertSame('urn:performance:problem:not-found', $this->body($response)['type']);
    }

    public function testRequiresASession(): void
    {
        $response = $this->send('GET', '/api/entries?personId=1&from=' . self::FROM);

        self::assertSame(401, $response->getStatusCode());
    }

    /**
     * @param array<string, int> $entry
     */
    private function add(string $id, array $entry, ?string $session = null): void
    {
        $response = $this->send('PUT', "/api/entries/{$id}", $entry, $session ?? $this->session);
        self::assertSame(201, $response->getStatusCode(), (string) $response->getBody());
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function entries(ResponseInterface $response): array
    {
        $entries = $this->body($response)['entries'];
        self::assertIsArray($entries);

        /** @var list<array<string, mixed>> $entries */
        return $entries;
    }

    private function history(string $query): ResponseInterface
    {
        return $this->send('GET', "/api/entries?{$query}", session: $this->session);
    }
}
