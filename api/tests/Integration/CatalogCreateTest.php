<?php

declare(strict_types=1);

namespace Performance\Tests\Integration;

use Performance\Tests\Support\DatabaseTestCase;
use PHPUnit\Framework\Attributes\DataProvider;

final class CatalogCreateTest extends DatabaseTestCase
{
    public function testCreatesAPersonWithATrimmedNameAndListsPersonsAlphabetically(): void
    {
        $session = $this->signIn();

        $created = $this->send('POST', '/api/persons', ['name' => '  Daniel  '], $session);
        $this->send('POST', '/api/persons', ['name' => 'anna'], $session);
        $this->send('POST', '/api/persons', ['name' => 'Ben'], $session);

        self::assertSame(201, $created->getStatusCode());
        self::assertSame(['id' => 1, 'name' => 'Daniel'], $this->body($created));
        $list = $this->send('GET', '/api/persons', session: $session);
        self::assertSame(200, $list->getStatusCode());
        self::assertSame(
            [['id' => 2, 'name' => 'anna'], ['id' => 3, 'name' => 'Ben'], ['id' => 1, 'name' => 'Daniel']],
            $this->body($list)['persons'],
        );
    }

    public function testCreatesADrinkWithPointsAndListsDrinksAlphabetically(): void
    {
        $session = $this->signIn();

        $created = $this->send('POST', '/api/drinks', ['name' => 'Bier', 'points' => 1], $session);
        $this->send('POST', '/api/drinks', ['name' => 'Aperol', 'points' => 2.5], $session);
        $this->send('POST', '/api/drinks', ['name' => 'Wasser', 'points' => 0], $session);
        $this->send('POST', '/api/drinks', ['name' => 'Fass', 'points' => 9999.99], $session);

        self::assertSame(201, $created->getStatusCode());
        self::assertSame(['id' => 1, 'name' => 'Bier', 'points' => 1], $this->body($created));
        self::assertSame(
            [
                ['id' => 2, 'name' => 'Aperol', 'points' => 2.5],
                ['id' => 1, 'name' => 'Bier', 'points' => 1],
                ['id' => 4, 'name' => 'Fass', 'points' => 9999.99],
                ['id' => 3, 'name' => 'Wasser', 'points' => 0],
            ],
            $this->body($this->send('GET', '/api/drinks', session: $session))['drinks'],
        );
    }

    /**
     * @return iterable<string, array{string, array<string, mixed>}>
     */
    public static function duplicates(): iterable
    {
        yield 'person' => ['/api/persons', []];
        yield 'drink' => ['/api/drinks', ['points' => 1]];
    }

    /**
     * @param array<string, mixed> $extra
     */
    #[DataProvider('duplicates')]
    public function testANameThatDiffersOnlyInCaseIs409(string $path, array $extra): void
    {
        $session = $this->signIn();
        $this->send('POST', $path, ['name' => 'Daniel', ...$extra], $session);

        $response = $this->send('POST', $path, ['name' => ' DANIEL ', ...$extra], $session);

        self::assertSame(409, $response->getStatusCode());
        self::assertSame('application/problem+json', $response->getHeaderLine('Content-Type'));
        self::assertSame(
            ['type' => 'urn:performance:problem:duplicate-name', 'title' => 'Name ist bereits vergeben.', 'status' => 409],
            $this->body($response),
        );
    }

    /**
     * @return iterable<string, array{mixed}>
     */
    public static function invalidNames(): iterable
    {
        yield 'empty' => [''];
        yield 'only spaces' => ['   '];
        yield '41 characters' => [str_repeat('ü', 41)];
        yield 'not text' => [12];
        yield 'missing' => [null];
    }

    #[DataProvider('invalidNames')]
    public function testANameOutside1To40CharactersIs422(mixed $name): void
    {
        $session = $this->signIn();

        $person = $this->send('POST', '/api/persons', $name === null ? [] : ['name' => $name], $session);
        $drink = $this->send('POST', '/api/drinks', ['name' => $name, 'points' => 1], $session);

        foreach ([$person, $drink] as $response) {
            self::assertSame(422, $response->getStatusCode());
            self::assertSame(['name' => '1 bis 40 Zeichen.'], $this->body($response)['errors']);
        }
        self::assertSame([], $this->rows('SELECT id FROM persons UNION ALL SELECT id FROM drinks'));
    }

    public function testANameOf40CharactersIsAccepted(): void
    {
        $response = $this->send('POST', '/api/persons', ['name' => str_repeat('ü', 40)], $this->signIn());

        self::assertSame(201, $response->getStatusCode());
    }

    /**
     * @return iterable<string, array{mixed}>
     */
    public static function invalidPoints(): iterable
    {
        yield 'negative' => [-0.01];
        yield 'above 9999.99' => [10000];
        yield 'three decimals' => [1.005];
        yield 'text' => ['1,5'];
        yield 'missing' => [null];
    }

    #[DataProvider('invalidPoints')]
    public function testDrinkPointsOutside0To9999Point99Are422(mixed $points): void
    {
        $response = $this->send(
            'POST',
            '/api/drinks',
            $points === null ? ['name' => 'Bier'] : ['name' => 'Bier', 'points' => $points],
            $this->signIn(),
        );

        self::assertSame(422, $response->getStatusCode());
        self::assertSame(['points' => 'Zahl von 0 bis 9.999,99.'], $this->body($response)['errors']);
    }

    public function testPersonsAndDrinksNeedASession(): void
    {
        foreach ([['GET', '/api/persons'], ['POST', '/api/persons'], ['GET', '/api/drinks'], ['POST', '/api/drinks']] as [$method, $path]) {
            $response = $this->send($method, $path, $method === 'POST' ? ['name' => 'X', 'points' => 1] : null);

            self::assertSame(401, $response->getStatusCode(), "{$method} {$path}");
        }
    }
}
