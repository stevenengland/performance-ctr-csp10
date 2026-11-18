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
use Slim\Psr7\Factory\StreamFactory;

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
        $problems = new ProblemDetailsHandler($responses);
        $signedIn = new SessionAuth($database, $responses, $problems);
        $adminOnly = new AdminOnly($responses);
        $jsonBody = new JsonBody($responses);
        $photoBody = new BodyLimit($responses, new StreamFactory(), PersonPhotoActions::MAX_BODY_BYTES);
        // Route middleware added last runs first: SessionAuth, then AdminOnly or a route's
        // BodyLimit, then JsonBody, so a request without a session is 401 before its body is
        // looked at, and a bounded body is 413 before it is parsed. Unknown routes and methods
        // stay 404/405 whatever their body.
        $member = static function (RouteInterface $route, ?BodyLimit $limit = null) use ($jsonBody, $signedIn): RouteInterface {
            $route->add($jsonBody);
            if ($limit !== null) {
                $route->add($limit);
            }

            return $route->add($signedIn);
        };
        $admin = static fn(RouteInterface $route): RouteInterface => $route->add($jsonBody)->add($adminOnly)->add($signedIn);
        $session = new SessionActions($database, $config->bootstrapAdmin);
        $accounts = new AccountActions($database);
        $photoUrl = new PhotoUrl($basePath);
        $catalog = new CatalogActions($database, $photoUrl);
        $photos = new PersonPhotoActions($database, $photoUrl);
        $entries = new EntryActions($database);
        $audit = new AuditActions($database);
        $games = new GameActions($database);
        $matches = new MatchActions($database);
        $results = new ResultActions($database);
        $verification = new VerificationActions($database);
        $days = new DaysActions($database);

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
        $member($app->get($person . '/photo', $photos->read(...)));
        $member($app->put($person . '/photo', $photos->put(...)), $photoBody);
        $member($app->delete($person . '/photo', $photos->remove(...)));
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
        $member($app->put($entry . '/verification', $verification->verifyEntry(...)));
        $member($app->delete($entry . '/verification', $verification->rejectEntry(...)));
        $member($app->get('/api/pending', $verification->queue(...)));
        $member($app->get('/api/scoreboard', new ScoreboardAction($database, $photoUrl)));
        $member($app->get('/api/scoreboard/days', $days->drinks(...)));
        $member($app->get('/api/games', $games->list(...)));
        $member($app->post('/api/games', $games->create(...)));
        $game = '/api/games/{id:' . CatalogActions::ID_PATTERN . '}';
        $member($app->get($game, $games->read(...)));
        $member($app->patch($game, $games->update(...)));
        $member($app->delete($game, $games->delete(...)));
        $member($app->post($game . '/restart', $games->restart(...)));
        $member($app->get($game . '/standings', new StandingsAction($database)));
        $member($app->get($game . '/standings/days', $days->game(...)));
        $member($app->get($game . '/matches', $matches->list(...)));
        $member($app->get($game . '/results', $results->list(...)));
        $match = '/api/matches/{id:' . EntryActions::ID_PATTERN . '}';
        $member($app->put($match, $matches->put(...)));
        $member($app->delete($match, $matches->delete(...)));
        $member($app->put($match . '/verification', $verification->verifyMatch(...)));
        $member($app->delete($match . '/verification', $verification->rejectMatch(...)));
        $result = '/api/results/{id:' . EntryActions::ID_PATTERN . '}';
        $member($app->put($result, $results->put(...)));
        $member($app->delete($result, $results->delete(...)));
        $member($app->put($result . '/verification', $verification->verifyResult(...)));
        $member($app->delete($result . '/verification', $verification->rejectResult(...)));
        $admin($app->get('/api/audit', $audit->list(...)));

        $app->addRoutingMiddleware();
        $app->add(new MigrationGate($database, $responses, $basePath . '/api/health'));
        // Before the migration gate: an outdated client is told to reload, whatever the schema's state.
        $app->add(new ClientVersionGate($responses, $basePath));
        $app->addErrorMiddleware(false, false, false)
            ->setDefaultErrorHandler($problems);
        // Outermost, so problem responses carry it too. An action that sets its own
        // Cache-Control keeps it; only the served photo does.
        $app->add(static function (ServerRequestInterface $request, RequestHandlerInterface $handler): ResponseInterface {
            $response = $handler->handle($request);

            return $response->hasHeader('Cache-Control') ? $response : $response->withHeader('Cache-Control', 'no-store');
        });

        return $app;
    }
}
