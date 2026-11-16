<?php

declare(strict_types=1);

namespace Performance\Tests\Integration;

use Performance\Tests\Support\DatabaseTestCase;
use PHPUnit\Framework\Attributes\DataProvider;

final class EntriesTest extends DatabaseTestCase
{
    private const ENTRY = '6f1c2d3e-4a5b-4c6d-8e7f-90a1b2c3d4e5';

    private string $session;

    protected function setUp(): void
    {
        parent::setUp();
        $this->session = $this->signIn();
        $this->send('POST', '/api/persons', ['name' => 'Daniel'], $this->session);
        $this->send('POST', '/api/drinks', ['name' => 'Bier', 'points' => 1], $this->session);
    }

    public function testRecordsAnEntryWithTheSignedInAccountAndTheServerTimeInUtc(): void
    {
        $this->createAccount('anna', 'annas-startpasswort');
        $anna = $this->signIn('anna', 'annas-startpasswort');

        $response = $this->send('PUT', '/api/entries/' . self::ENTRY, ['personId' => 1, 'drinkId' => 1, 'quantity' => 2], $anna);

        self::assertSame(201, $response->getStatusCode(), (string) $response->getBody());
        self::assertSame(
            ['id' => self::ENTRY, 'personId' => 1, 'drinkId' => 1, 'quantity' => 2, 'factorId' => null, 'createdAt' => '2026-11-14T20:00:00.000Z'],
            $this->body($response),
        );
        self::assertSame(
            [['id' => self::ENTRY, 'person_id' => 1, 'drink_id' => 1, 'quantity' => 2, 'account_id' => 2, 'created_at' => '2026-11-14 20:00:00.000']],
            $this->rows('SELECT id, person_id, drink_id, quantity, account_id, created_at FROM entries'),
        );
    }

    public function testAMissingPersonOrDrinkIs422AndRecordsNothing(): void
    {
        $person = $this->send('PUT', '/api/entries/' . self::ENTRY, ['personId' => 99, 'drinkId' => 1, 'quantity' => 1], $this->session);
        $drink = $this->send('PUT', '/api/entries/' . self::ENTRY, ['personId' => 1, 'drinkId' => 99, 'quantity' => 1], $this->session);
        $neither = $this->send('PUT', '/api/entries/' . self::ENTRY, ['quantity' => 1], $this->session);

        self::assertSame(422, $person->getStatusCode());
        self::assertSame(['personId' => 'Person nicht gefunden.'], $this->body($person)['errors']);
        self::assertSame(422, $drink->getStatusCode());
        self::assertSame(['drinkId' => 'Getränk nicht gefunden.'], $this->body($drink)['errors']);
        self::assertSame(
            ['personId' => 'Person nicht gefunden.', 'drinkId' => 'Getränk nicht gefunden.'],
            $this->body($neither)['errors'],
        );
        self::assertSame([], $this->rows('SELECT id FROM entries UNION ALL SELECT id FROM entry_requests'));
    }

    public function testAnUnknownFactorIs422AndRecordsNothing(): void
    {
        $unknown = $this->send('PUT', '/api/entries/' . self::ENTRY, ['personId' => 1, 'drinkId' => 1, 'quantity' => 1, 'factorId' => 7], $this->session);
        $notAnId = $this->send('PUT', '/api/entries/' . self::ENTRY, ['personId' => 1, 'drinkId' => 1, 'quantity' => 1, 'factorId' => '1'], $this->session);

        foreach ([$unknown, $notAnId] as $response) {
            self::assertSame(422, $response->getStatusCode(), (string) $response->getBody());
            self::assertSame(['factorId' => 'Faktor nicht gefunden.'], $this->body($response)['errors']);
        }
        self::assertSame([], $this->rows('SELECT id FROM entries UNION ALL SELECT id FROM entry_requests'));
    }

    public function testRecordsTheChosenFactor(): void
    {
        $this->send('POST', '/api/factors', ['name' => 'Happy Hour', 'multiplier' => 2], $this->session);

        $response = $this->send('PUT', '/api/entries/' . self::ENTRY, ['personId' => 1, 'drinkId' => 1, 'quantity' => 2, 'factorId' => 1], $this->session);

        self::assertSame(201, $response->getStatusCode(), (string) $response->getBody());
        self::assertSame(1, $this->body($response)['factorId']);
        self::assertSame([['factor_id' => 1]], $this->rows('SELECT factor_id FROM entries'));
    }

    /**
     * @return iterable<string, array{mixed}>
     */
    public static function invalidQuantities(): iterable
    {
        yield 'zero' => [0];
        yield 'one hundred' => [100];
        yield 'negative' => [-1];
        yield 'fraction' => [1.5];
        yield 'text' => ['2'];
        yield 'missing' => [null];
    }

    #[DataProvider('invalidQuantities')]
    public function testAQuantityOutside1To99Is422(mixed $quantity): void
    {
        $body = ['personId' => 1, 'drinkId' => 1];
        if ($quantity !== null) {
            $body['quantity'] = $quantity;
        }

        $response = $this->send('PUT', '/api/entries/' . self::ENTRY, $body, $this->session);

        self::assertSame(422, $response->getStatusCode());
        self::assertSame(['quantity' => '1 bis 99.'], $this->body($response)['errors']);
        self::assertSame([], $this->rows('SELECT id FROM entries'));
    }

    public function testAcceptsQuantities1And99(): void
    {
        $one = $this->send('PUT', '/api/entries/' . self::ENTRY, ['personId' => 1, 'drinkId' => 1, 'quantity' => 1], $this->session);
        $ninetyNine = $this->send('PUT', '/api/entries/0b8f5e3a-1c2d-4e5f-9a0b-1c2d3e4f5a6b', ['personId' => 1, 'drinkId' => 1, 'quantity' => 99], $this->session);

        self::assertSame(201, $one->getStatusCode());
        self::assertSame(201, $ninetyNine->getStatusCode());
    }

    public function testDeletesAnEntry(): void
    {
        $this->send('PUT', '/api/entries/' . self::ENTRY, ['personId' => 1, 'drinkId' => 1, 'quantity' => 2], $this->session);

        $response = $this->send('DELETE', '/api/entries/' . self::ENTRY, session: $this->session);

        self::assertSame(204, $response->getStatusCode());
        self::assertSame([], $this->rows('SELECT id FROM entries'));
    }

    public function testDeletingAnUnknownEntryIs404(): void
    {
        $response = $this->send('DELETE', '/api/entries/' . self::ENTRY, session: $this->session);

        self::assertSame(404, $response->getStatusCode());
        self::assertSame('urn:performance:problem:not-found', $this->body($response)['type']);
    }

    public function testAnIdThatIsNotALowerCaseUuidV4Is404(): void
    {
        foreach (['abc', strtoupper(self::ENTRY), '6f1c2d3e-4a5b-1c6d-8e7f-90a1b2c3d4e5'] as $id) {
            $response = $this->send('PUT', "/api/entries/{$id}", ['personId' => 1, 'drinkId' => 1, 'quantity' => 1], $this->session);

            self::assertSame(404, $response->getStatusCode(), $id);
        }
    }

    public function testEntriesNeedASession(): void
    {
        $put = $this->send('PUT', '/api/entries/' . self::ENTRY, ['personId' => 1, 'drinkId' => 1, 'quantity' => 1]);
        $delete = $this->send('DELETE', '/api/entries/' . self::ENTRY);

        self::assertSame(401, $put->getStatusCode());
        self::assertSame(401, $delete->getStatusCode());
    }
}
