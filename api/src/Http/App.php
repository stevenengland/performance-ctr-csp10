<?php

declare(strict_types=1);

namespace Performance\Http;

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
    public static function create(Config $config, string $basePath = ''): RequestHandlerInterface
    {
        $responses = new ResponseFactory();
        $database = new Database($config);
        $app = new SlimApp($responses);
        $app->setBasePath($basePath);

        $app->get('/api/health', new HealthAction($database, $config->appVersion));

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
