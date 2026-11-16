<?php

declare(strict_types=1);

namespace Performance\Http;

use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;

/**
 * `/api/accounts` (admins only): list and create accounts; `…/{id}` changes the admin
 * flag or resets the password, and deletes.
 */
final readonly class AccountActions
{
    public function __construct(private Database $database) {}

    public function list(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        return Json::write($response, [
            'accounts' => array_map(AccountJson::of(...), $this->database->accounts()->list()),
        ]);
    }

    public function create(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        $account = $this->database->accounts()->create(
            Input::text($request, 'userName'),
            Input::text($request, 'password'),
        );

        return Json::write($response, AccountJson::of($account), 201);
    }

    /**
     * @param array{id: string} $arguments
     */
    public function update(ServerRequestInterface $request, ResponseInterface $response, array $arguments): ResponseInterface
    {
        $account = $this->database->accounts()->update(
            (int) $arguments['id'],
            Input::optionalBoolean($request, 'isAdmin'),
            Input::optionalText($request, 'password'),
        );

        return Json::write($response, AccountJson::of($account));
    }

    /**
     * @param array{id: string} $arguments
     */
    public function delete(ServerRequestInterface $request, ResponseInterface $response, array $arguments): ResponseInterface
    {
        $this->database->accounts()->delete((int) $arguments['id']);

        return $response->withStatus(204);
    }
}
