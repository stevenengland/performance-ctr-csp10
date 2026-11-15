<?php

declare(strict_types=1);

namespace Performance\Http;

use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;

/**
 * `/api/accounts` (admins only): list and create accounts.
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
}
