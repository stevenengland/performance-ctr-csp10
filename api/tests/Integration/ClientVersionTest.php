<?php

declare(strict_types=1);

namespace Performance\Tests\Integration;

use Performance\Http\ClientVersionGate;
use Performance\Tests\Support\DatabaseTestCase;
use Psr\Http\Message\ResponseInterface;
use Slim\Psr7\Factory\ServerRequestFactory;

/**
 * The application refuses a web client below `MIN_CLIENT_VERSION` on any route but health,
 * before the route runs (ADR 0006, decision 3).
 */
final class ClientVersionTest extends DatabaseTestCase
{
    public function testAnOutdatedClientsSignInIsRefusedBeforeAnythingIsProcessed(): void
    {
        self::assertSame(200, $this->get('/api/health')->getStatusCode(), 'migrated');

        $response = $this->signInAs('0.0.9');

        self::assertSame(400, $response->getStatusCode());
        self::assertSame('urn:performance:problem:client-outdated', $this->body($response)['type']);
        self::assertSame('no-store', $response->getHeaderLine('Cache-Control'));
        self::assertSame('', $response->getHeaderLine('Set-Cookie'));
        self::assertSame([], $this->rows('SELECT id FROM accounts'), 'the bootstrap admin was not created');
    }

    public function testACurrentClientAndOneThatSendsNoVersionAreServed(): void
    {
        self::assertSame(200, $this->signInAs('0.2.0+abc1234')->getStatusCode());
        self::assertSame(200, $this->signInAs(null)->getStatusCode());
    }

    public function testHealthAnswersAnOutdatedClient(): void
    {
        $request = (new ServerRequestFactory())->createServerRequest('GET', '/api/health')
            ->withHeader(ClientVersionGate::HEADER, '0.0.9');

        self::assertSame(200, $this->app()->handle($request)->getStatusCode());
    }

    private function signInAs(?string $clientVersion): ResponseInterface
    {
        $request = (new ServerRequestFactory())->createServerRequest('POST', '/api/session')
            ->withHeader('Content-Type', 'application/json');
        $request->getBody()->write(json_encode(['userName' => self::ADMIN, 'password' => self::ADMIN_PASSWORD], JSON_THROW_ON_ERROR));

        return $this->app()->handle(
            $clientVersion === null ? $request : $request->withHeader(ClientVersionGate::HEADER, $clientVersion),
        );
    }
}
