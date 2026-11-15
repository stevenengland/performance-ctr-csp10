<?php

declare(strict_types=1);

namespace Performance\Http;

use Performance\Domain\BootstrapAdmin;
use Performance\Domain\Sessions;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;

/**
 * `/api/session`: sign in, the signed-in account, sign out, change the own password.
 */
final readonly class SessionActions
{
    public function __construct(
        private Database $database,
        private ?BootstrapAdmin $bootstrapAdmin,
    ) {}

    public function signIn(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        if ($this->bootstrapAdmin !== null) {
            $this->database->accounts()->ensureBootstrapAdmin($this->bootstrapAdmin);
        }
        $address = $request->getServerParams()['REMOTE_ADDR'] ?? '';
        $session = $this->database->sessions()->signIn(
            Input::text($request, 'userName'),
            Input::text($request, 'password'),
            is_string($address) ? $address : '',
        );

        return SessionCookie::issue(Json::write($response, AccountJson::of($session->account)), $session->token);
    }

    public function current(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        return Json::write($response, AccountJson::of(SessionAuth::account($request)));
    }

    public function signOut(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        $this->database->sessions()->revoke(SessionAuth::token($request));

        return SessionCookie::clear($response->withStatus(204));
    }

    /** Changes the password and signs the account out on every other device. */
    public function changePassword(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        $account = SessionAuth::account($request);
        $this->database->accounts()->changePassword(
            $account->id,
            Input::text($request, 'currentPassword'),
            Input::text($request, 'newPassword'),
            Sessions::tokenHash(SessionAuth::token($request)),
        );

        return $response->withStatus(204);
    }
}
