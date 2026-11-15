<?php

declare(strict_types=1);

namespace Performance\Http;

use Performance\Domain\Catalog\Drink;
use Performance\Domain\Catalog\Person;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;

/**
 * `/api/persons` and `/api/drinks`: list and create.
 */
final readonly class CatalogActions
{
    public function __construct(private Database $database) {}

    public function persons(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        return Json::write($response, ['persons' => array_map(self::person(...), $this->database->catalog()->persons())]);
    }

    public function createPerson(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        $person = $this->database->catalog()->createPerson(Input::text($request, 'name'));

        return Json::write($response, self::person($person), 201);
    }

    public function drinks(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        return Json::write($response, ['drinks' => array_map(self::drink(...), $this->database->catalog()->drinks())]);
    }

    public function createDrink(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        $drink = $this->database->catalog()->createDrink(Input::text($request, 'name'), Input::number($request, 'points'));

        return Json::write($response, self::drink($drink), 201);
    }

    /**
     * @return array{id: int, name: string}
     */
    private static function person(Person $person): array
    {
        return ['id' => $person->id, 'name' => $person->name];
    }

    /**
     * @return array{id: int, name: string, points: int|float}
     */
    private static function drink(Drink $drink): array
    {
        return ['id' => $drink->id, 'name' => $drink->name, 'points' => Decimal::json($drink->points)];
    }
}
