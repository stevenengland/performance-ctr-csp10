<?php

declare(strict_types=1);

namespace Performance\Tests\Integration;

use Performance\Tests\Support\DatabaseTestCase;
use PHPUnit\Framework\Attributes\DataProvider;
use Psr\Http\Message\ResponseInterface;

/** Reading, renaming, editing and deleting persons and drinks. */
final class CatalogManageTest extends DatabaseTestCase
{
    private string $session;
    private int $entries = 0;

    protected function setUp(): void
    {
        parent::setUp();
        $this->session = $this->signIn();
    }

    public function testRenamesAPersonWithATrimmedNameAndKeepsTheListAlphabetical(): void
    {
        $this->send('POST', '/api/persons', ['name' => 'Daniel'], $this->session);
        $this->send('POST', '/api/persons', ['name' => 'Mara'], $this->session);

        $response = $this->send('PATCH', '/api/persons/1', ['name' => '  Tom '], $this->session);

        self::assertSame(200, $response->getStatusCode(), (string) $response->getBody());
        self::assertSame(['id' => 1, 'name' => 'Tom', 'photoUrl' => null], $this->body($response));
        self::assertSame(
            [['id' => 2, 'name' => 'Mara', 'photoUrl' => null], ['id' => 1, 'name' => 'Tom', 'photoUrl' => null]],
            $this->body($this->send('GET', '/api/persons', session: $this->session))['persons'],
        );
    }

    public function testEditsADrinksNameAndPoints(): void
    {
        $this->send('POST', '/api/drinks', ['name' => 'Bier', 'points' => 1], $this->session);
        $this->send('POST', '/api/drinks', ['name' => 'Wein', 'points' => 2], $this->session);

        $response = $this->send('PATCH', '/api/drinks/1', ['name' => ' Zwickel ', 'points' => 1.25], $this->session);

        self::assertSame(200, $response->getStatusCode(), (string) $response->getBody());
        self::assertSame(['id' => 1, 'name' => 'Zwickel', 'points' => 1.25], $this->body($response));
        self::assertSame(
            [['id' => 2, 'name' => 'Wein', 'points' => 2], ['id' => 1, 'name' => 'Zwickel', 'points' => 1.25]],
            $this->body($this->send('GET', '/api/drinks', session: $this->session))['drinks'],
        );
    }

    public function testRenamingKeepsItsOwnNameInAnotherCaseButRefusesAnothersName(): void
    {
        $this->send('POST', '/api/persons', ['name' => 'Daniel'], $this->session);
        $this->send('POST', '/api/persons', ['name' => 'Mara'], $this->session);
        $this->send('POST', '/api/drinks', ['name' => 'Bier', 'points' => 1], $this->session);
        $this->send('POST', '/api/drinks', ['name' => 'Wein', 'points' => 2], $this->session);

        $ownPerson = $this->send('PATCH', '/api/persons/1', ['name' => 'DANIEL'], $this->session);
        $takenPerson = $this->send('PATCH', '/api/persons/1', ['name' => 'mara'], $this->session);
        $ownDrink = $this->send('PATCH', '/api/drinks/1', ['name' => 'bier', 'points' => 1], $this->session);
        $takenDrink = $this->send('PATCH', '/api/drinks/1', ['name' => 'WEIN', 'points' => 1], $this->session);

        self::assertSame(200, $ownPerson->getStatusCode());
        self::assertSame(200, $ownDrink->getStatusCode());
        foreach ([$takenPerson, $takenDrink] as $taken) {
            self::assertSame(409, $taken->getStatusCode());
            self::assertSame('urn:performance:problem:duplicate-name', $this->body($taken)['type']);
            self::assertSame('Name ist bereits vergeben.', $this->body($taken)['title']);
        }
        self::assertSame([['name' => 'DANIEL'], ['name' => 'Mara']], $this->rows('SELECT name FROM persons ORDER BY id'));
        self::assertSame([['name' => 'bier', 'points' => '1.00'], ['name' => 'Wein', 'points' => '2.00']], $this->rows('SELECT name, points FROM drinks ORDER BY id'));
    }

    /**
     * @return iterable<string, array{string, array<string, mixed>, array<string, string>}>
     */
    public static function invalidEdits(): iterable
    {
        yield 'a blank person name' => ['/api/persons/1', ['name' => '   '], ['name' => '1 bis 40 Zeichen.']];
        yield 'a person name of 41 characters' => ['/api/persons/1', ['name' => str_repeat('x', 41)], ['name' => '1 bis 40 Zeichen.']];
        yield 'a blank drink name and negative points' => ['/api/drinks/1', ['name' => '', 'points' => -1], ['name' => '1 bis 40 Zeichen.', 'points' => 'Zahl von 0 bis 9.999,99.']];
        yield 'points above 9 999.99' => ['/api/drinks/1', ['name' => 'Bier', 'points' => 10000], ['points' => 'Zahl von 0 bis 9.999,99.']];
        yield 'points with three decimals' => ['/api/drinks/1', ['name' => 'Bier', 'points' => 1.005], ['points' => 'Zahl von 0 bis 9.999,99.']];
        yield 'points with a decimal comma' => ['/api/drinks/1', ['name' => 'Bier', 'points' => '1,5'], ['points' => 'Zahl von 0 bis 9.999,99.']];
        yield 'missing points' => ['/api/drinks/1', ['name' => 'Bier'], ['points' => 'Zahl von 0 bis 9.999,99.']];
    }

    /**
     * @param array<string, mixed>  $json
     * @param array<string, string> $errors
     */
    #[DataProvider('invalidEdits')]
    public function testEditingValidatesLikeCreating(string $path, array $json, array $errors): void
    {
        $this->send('POST', '/api/persons', ['name' => 'Daniel'], $this->session);
        $this->send('POST', '/api/drinks', ['name' => 'Bier', 'points' => 1], $this->session);

        $response = $this->send('PATCH', $path, $json, $this->session);

        self::assertSame(422, $response->getStatusCode());
        self::assertSame($errors, $this->body($response)['errors']);
        self::assertSame([['name' => 'Daniel']], $this->rows('SELECT name FROM persons'));
        self::assertSame([['name' => 'Bier', 'points' => '1.00']], $this->rows('SELECT name, points FROM drinks'));
    }

    public function testPointsFrom0To9999Point99AreAcceptedOnEdit(): void
    {
        $this->send('POST', '/api/drinks', ['name' => 'Bier', 'points' => 1], $this->session);

        $none = $this->send('PATCH', '/api/drinks/1', ['name' => 'Wasser', 'points' => 0], $this->session);
        $most = $this->send('PATCH', '/api/drinks/1', ['name' => 'Absinth', 'points' => 9999.99], $this->session);

        self::assertSame(['id' => 1, 'name' => 'Wasser', 'points' => 0], $this->body($none));
        self::assertSame(['id' => 1, 'name' => 'Absinth', 'points' => 9999.99], $this->body($most));
    }

    public function testReadsAPersonAndADrinkWithTheirEntryCountsOfEveryDay(): void
    {
        $this->evening();
        $this->send('POST', '/api/drinks', ['name' => 'Wein', 'points' => 2], $this->session);
        $this->add(1, 1, 2);
        $this->add(1, 1, 1);
        $this->add(1, 2, 1);
        $this->otherSession()->exec("UPDATE entries SET created_at = '2026-10-01 20:00:00.000' WHERE quantity = 2");

        $person = $this->send('GET', '/api/persons/1', session: $this->session);
        $drink = $this->send('GET', '/api/drinks/1', session: $this->session);

        self::assertSame(200, $person->getStatusCode());
        self::assertSame(['id' => 1, 'name' => 'Daniel', 'photoUrl' => null, 'entryCount' => 3, 'matchCount' => 0, 'resultCount' => 0], $this->body($person));
        self::assertSame(200, $drink->getStatusCode());
        self::assertSame(['id' => 1, 'name' => 'Bier', 'points' => 1.5, 'entryCount' => 2], $this->body($drink));
    }

    public function testDeletingAPersonDeletesItsEntriesAndItLeavesTheScoreboard(): void
    {
        $this->evening();
        $this->send('POST', '/api/persons', ['name' => 'Mara'], $this->session);
        $this->add(1, 1, 2);
        $this->add(2, 1, 1);

        $deleted = $this->send('DELETE', '/api/persons/1', session: $this->session);

        self::assertSame(204, $deleted->getStatusCode());
        self::assertSame([['id' => 2, 'name' => 'Mara', 'photoUrl' => null]], $this->body($this->send('GET', '/api/persons', session: $this->session))['persons']);
        self::assertSame([['person_id' => '2']], $this->rows('SELECT CAST(person_id AS CHAR) AS person_id FROM entries'));
        self::assertSame([2], array_column($this->standings(), 'personId'));
    }

    public function testDeletingADrinkDeletesItsEntriesAndItsCounters(): void
    {
        $this->evening();
        $this->send('POST', '/api/drinks', ['name' => 'Wein', 'points' => 2], $this->session);
        $this->add(1, 1, 2);
        $this->add(1, 2, 1);

        $deleted = $this->send('DELETE', '/api/drinks/1', session: $this->session);

        self::assertSame(204, $deleted->getStatusCode());
        self::assertSame([['id' => 2, 'name' => 'Wein', 'points' => 2]], $this->body($this->send('GET', '/api/drinks', session: $this->session))['drinks']);
        self::assertSame([['drink_id' => '2']], $this->rows('SELECT CAST(drink_id AS CHAR) AS drink_id FROM entries'));
        self::assertSame(
            [['personId' => 1, 'name' => 'Daniel', 'photoUrl' => null, 'score' => 2, 'count' => 1, 'drinks' => [['drinkId' => 2, 'name' => 'Wein', 'count' => 1]]]],
            $this->standings(),
        );
    }

    public function testEditingADrinksPointsChangesTodaysScoresOfItsEntries(): void
    {
        $this->evening();
        $this->add(1, 1, 2);
        self::assertSame(3, $this->standings()[0]['score']);

        $this->send('PATCH', '/api/drinks/1', ['name' => 'Bier', 'points' => 2.25], $this->session);

        self::assertSame(4.5, $this->standings()[0]['score']);
        self::assertSame(2, $this->standings()[0]['count']);
    }

    public function testARenameShowsOnTheScoreboard(): void
    {
        $this->evening();
        $this->add(1, 1, 1);

        $this->send('PATCH', '/api/persons/1', ['name' => 'Dani'], $this->session);
        $this->send('PATCH', '/api/drinks/1', ['name' => 'Helles', 'points' => 1.5], $this->session);

        self::assertSame('Dani', $this->standings()[0]['name']);
        self::assertSame([['drinkId' => 1, 'name' => 'Helles', 'count' => 1]], $this->standings()[0]['drinks']);
    }

    /**
     * @return iterable<string, array{string, string, array<string, mixed>|null}>
     */
    public static function unknownIds(): iterable
    {
        foreach (['persons', 'drinks'] as $items) {
            yield "GET {$items}/7" => ['GET', "/api/{$items}/7", null];
            yield "PATCH {$items}/7" => ['PATCH', "/api/{$items}/7", ['name' => 'Neu', 'points' => 1]];
            yield "DELETE {$items}/7" => ['DELETE', "/api/{$items}/7", null];
            yield "GET {$items}/abc" => ['GET', "/api/{$items}/abc", null];
            yield "GET {$items}/0" => ['GET', "/api/{$items}/0", null];
        }
    }

    /**
     * @param array<string, mixed>|null $json
     */
    #[DataProvider('unknownIds')]
    public function testAnUnknownIdIs404ProblemDetails(string $method, string $path, ?array $json): void
    {
        $response = $this->send($method, $path, $json, $this->session);

        self::assertSame(404, $response->getStatusCode());
        self::assertStringStartsWith('application/problem+json', $response->getHeaderLine('Content-Type'));
        self::assertSame('urn:performance:problem:not-found', $this->body($response)['type']);
    }

    public function testManagingNeedsASession(): void
    {
        foreach (['persons', 'drinks'] as $items) {
            self::assertSame(401, $this->send('GET', "/api/{$items}/1")->getStatusCode());
            self::assertSame(401, $this->send('PATCH', "/api/{$items}/1", ['name' => 'Neu', 'points' => 1])->getStatusCode());
            self::assertSame(401, $this->send('DELETE', "/api/{$items}/1")->getStatusCode());
        }
    }

    /** Daniel and a beer worth 1.5 points. */
    private function evening(): void
    {
        $this->send('POST', '/api/persons', ['name' => 'Daniel'], $this->session);
        $this->send('POST', '/api/drinks', ['name' => 'Bier', 'points' => 1.5], $this->session);
    }

    private function add(int $personId, int $drinkId, int $quantity): ResponseInterface
    {
        ++$this->entries;
        $id = sprintf('00000000-0000-4000-8000-%012d', $this->entries);
        $response = $this->send('PUT', "/api/entries/{$id}", ['personId' => $personId, 'drinkId' => $drinkId, 'quantity' => $quantity], $this->session);
        self::assertSame(201, $response->getStatusCode(), (string) $response->getBody());

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
