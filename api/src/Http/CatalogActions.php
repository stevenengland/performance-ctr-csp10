<?php

declare(strict_types=1);

namespace Performance\Http;

use Performance\Domain\Catalog\Drink;
use Performance\Domain\Catalog\Factor;
use Performance\Domain\Catalog\Person;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;

/**
 * `/api/persons`, `/api/drinks` and `/api/factors`: list and create; factors also read, edit and delete.
 */
final readonly class CatalogActions
{
    /** A catalog id: a positive integer that fits the INT UNSIGNED column (larger ones match no row). */
    public const ID_PATTERN = '[1-9][0-9]{0,9}';

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

    public function factors(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        return Json::write($response, ['factors' => array_map(self::factor(...), $this->database->catalog()->factors())]);
    }

    public function createFactor(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        $factor = $this->database->catalog()->createFactor(Input::text($request, 'name'), Input::number($request, 'multiplier'));

        return Json::write($response, self::factor($factor), 201);
    }

    /**
     * @param array{id: string} $arguments
     */
    public function readFactor(ServerRequestInterface $request, ResponseInterface $response, array $arguments): ResponseInterface
    {
        $catalog = $this->database->catalog();
        $id = (int) $arguments['id'];

        return Json::write($response, [...self::factor($catalog->factor($id)), 'entryCount' => $catalog->entriesWithFactor($id)]);
    }

    /**
     * @param array{id: string} $arguments
     */
    public function updateFactor(ServerRequestInterface $request, ResponseInterface $response, array $arguments): ResponseInterface
    {
        $factor = $this->database->catalog()->updateFactor(
            (int) $arguments['id'],
            Input::text($request, 'name'),
            Input::number($request, 'multiplier'),
        );

        return Json::write($response, self::factor($factor));
    }

    /**
     * @param array{id: string} $arguments
     */
    public function deleteFactor(ServerRequestInterface $request, ResponseInterface $response, array $arguments): ResponseInterface
    {
        $this->database->catalog()->deleteFactor((int) $arguments['id']);

        return $response->withStatus(204);
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

    /**
     * @return array{id: int, name: string, multiplier: int|float}
     */
    private static function factor(Factor $factor): array
    {
        return ['id' => $factor->id, 'name' => $factor->name, 'multiplier' => Decimal::json($factor->multiplier)];
    }
}
