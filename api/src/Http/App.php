<?php

declare(strict_types=1);

namespace Performance\Http;

use Performance\Domain\Clock;
use Performance\Domain\SystemClock;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\RequestHandlerInterface;
use Slim\App as SlimApp;
use Slim\Interfaces\RouteInterface;
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
        $jsonBody = new JsonBody($responses);
        // Route middleware added last runs first: SessionAuth, then AdminOnly, then
        // JsonBody, so a request without a session is 401 before its body is looked at.
        // Unknown routes and methods stay 404/405 whatever their body.
        $member = static fn(RouteInterface $route): RouteInterface => $route->add($jsonBody)->add($signedIn);
        $admin = static fn(RouteInterface $route): RouteInterface => $route->add($jsonBody)->add($adminOnly)->add($signedIn);
        $session = new SessionActions($database, $config->bootstrapAdmin);
        $accounts = new AccountActions($database);
        $catalog = new CatalogActions($database);
        $entries = new EntryActions($database);
        $audit = new AuditActions($database);
        $games = new GameActions($database);

        // Open routes: health and sign-in. Every other route requires a session.
        $app->get('/api/health', new HealthAction($database, $config->appVersion));
        $app->post('/api/session', $session->signIn(...))->add($jsonBody);

        $member($app->get('/api/session', $session->current(...)));
        $member($app->delete('/api/session', $session->signOut(...)));
        $member($app->put('/api/session/password', $session->changePassword(...)));
        $admin($app->get('/api/accounts', $accounts->list(...)));
        $admin($app->post('/api/accounts', $accounts->create(...)));
        $account = '/api/accounts/{id:' . CatalogActions::ID_PATTERN . '}';
        $admin($app->patch($account, $accounts->update(...)));
        $admin($app->delete($account, $accounts->delete(...)));
        $member($app->get('/api/persons', $catalog->persons(...)));
        $member($app->post('/api/persons', $catalog->createPerson(...)));
        $member($app->get('/api/drinks', $catalog->drinks(...)));
        $member($app->post('/api/drinks', $catalog->createDrink(...)));
        $person = '/api/persons/{id:' . CatalogActions::ID_PATTERN . '}';
        $member($app->get($person, $catalog->readPerson(...)));
        $member($app->patch($person, $catalog->updatePerson(...)));
        $member($app->delete($person, $catalog->deletePerson(...)));
        $drink = '/api/drinks/{id:' . CatalogActions::ID_PATTERN . '}';
        $member($app->get($drink, $catalog->readDrink(...)));
        $member($app->patch($drink, $catalog->updateDrink(...)));
        $member($app->delete($drink, $catalog->deleteDrink(...)));
        $member($app->get('/api/factors', $catalog->factors(...)));
        $member($app->post('/api/factors', $catalog->createFactor(...)));
        $factor = '/api/factors/{id:' . CatalogActions::ID_PATTERN . '}';
        $member($app->get($factor, $catalog->readFactor(...)));
        $member($app->patch($factor, $catalog->updateFactor(...)));
        $member($app->delete($factor, $catalog->deleteFactor(...)));
        $member($app->get('/api/entries', $entries->list(...)));
        $entry = '/api/entries/{id:' . EntryActions::ID_PATTERN . '}';
        $member($app->put($entry, $entries->put(...)));
        $member($app->delete($entry, $entries->delete(...)));
        $member($app->get('/api/scoreboard', new ScoreboardAction($database)));
        $member($app->get('/api/games', $games->list(...)));
        $member($app->post('/api/games', $games->create(...)));
        $game = '/api/games/{id:' . CatalogActions::ID_PATTERN . '}';
        $member($app->get($game, $games->read(...)));
        $member($app->patch($game, $games->update(...)));
        $member($app->delete($game, $games->delete(...)));
        $member($app->post($game . '/restart', $games->restart(...)));
        $admin($app->get('/api/audit', $audit->list(...)));

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
