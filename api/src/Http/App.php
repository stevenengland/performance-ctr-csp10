<?php

declare(strict_types=1);

namespace Performance\Http;

use Performance\Domain\Clock;
use Performance\Domain\SystemClock;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\RequestHandlerInterface;
use Slim\App as SlimApp;
use Slim\Psr7\Factory\ResponseFactory;

/**
 * The composition root: constructs and wires every module of the API.
 */
final class App
{
    public static function create(Config $config, string $basePath = '', ?Clock $clock = null): RequestHandlerInterface
    {
        $responses = new ResponseFactory();
        $database = new Database($config, $clock ?? new SystemClock());
        $app = new SlimApp($responses);
        $app->setBasePath($basePath);
        $signedIn = new SessionAuth($database, $responses);
        $adminOnly = new AdminOnly($responses);
        $session = new SessionActions($database, $config->bootstrapAdmin);
        $accounts = new AccountActions($database);
        $catalog = new CatalogActions($database);
        $entries = new EntryActions($database);

        // Open routes: health and sign-in. Every other route requires a session.
        $app->get('/api/health', new HealthAction($database, $config->appVersion));
        $app->post('/api/session', $session->signIn(...));

        $app->get('/api/session', $session->current(...))->add($signedIn);
        $app->delete('/api/session', $session->signOut(...))->add($signedIn);
        $app->put('/api/session/password', $session->changePassword(...))->add($signedIn);
        // Route middleware added last runs first: SessionAuth, then AdminOnly.
        $app->get('/api/accounts', $accounts->list(...))->add($adminOnly)->add($signedIn);
        $app->post('/api/accounts', $accounts->create(...))->add($adminOnly)->add($signedIn);
        $account = '/api/accounts/{id:' . CatalogActions::ID_PATTERN . '}';
        $app->patch($account, $accounts->update(...))->add($adminOnly)->add($signedIn);
        $app->delete($account, $accounts->delete(...))->add($adminOnly)->add($signedIn);
        $app->get('/api/persons', $catalog->persons(...))->add($signedIn);
        $app->post('/api/persons', $catalog->createPerson(...))->add($signedIn);
        $app->get('/api/drinks', $catalog->drinks(...))->add($signedIn);
        $app->post('/api/drinks', $catalog->createDrink(...))->add($signedIn);
        $person = '/api/persons/{id:' . CatalogActions::ID_PATTERN . '}';
        $app->get($person, $catalog->readPerson(...))->add($signedIn);
        $app->patch($person, $catalog->updatePerson(...))->add($signedIn);
        $app->delete($person, $catalog->deletePerson(...))->add($signedIn);
        $drink = '/api/drinks/{id:' . CatalogActions::ID_PATTERN . '}';
        $app->get($drink, $catalog->readDrink(...))->add($signedIn);
        $app->patch($drink, $catalog->updateDrink(...))->add($signedIn);
        $app->delete($drink, $catalog->deleteDrink(...))->add($signedIn);
        $app->get('/api/factors', $catalog->factors(...))->add($signedIn);
        $app->post('/api/factors', $catalog->createFactor(...))->add($signedIn);
        $factor = '/api/factors/{id:' . CatalogActions::ID_PATTERN . '}';
        $app->get($factor, $catalog->readFactor(...))->add($signedIn);
        $app->patch($factor, $catalog->updateFactor(...))->add($signedIn);
        $app->delete($factor, $catalog->deleteFactor(...))->add($signedIn);
        $app->get('/api/entries', $entries->list(...))->add($signedIn);
        $entry = '/api/entries/{id:' . EntryActions::ID_PATTERN . '}';
        $app->put($entry, $entries->put(...))->add($signedIn);
        $app->delete($entry, $entries->delete(...))->add($signedIn);
        $app->get('/api/scoreboard', new ScoreboardAction($database))->add($signedIn);

        // Inside routing, so an unknown route or method stays 404/405 whatever its body.
        $app->add(new JsonBody($responses));
        $app->addRoutingMiddleware();
        $app->add(new MigrationGate($database, $responses, $basePath . '/api/health'));
        $app->addErrorMiddleware(false, false, false)
            ->setDefaultErrorHandler(new ProblemDetailsHandler($responses));
        // Outermost, so problem responses carry it too.
        $app->add(static function (ServerRequestInterface $request, RequestHandlerInterface $handler): ResponseInterface {
            return $handler->handle($request)->withHeader('Cache-Control', 'no-store');
        });

        return $app;
    }
}
