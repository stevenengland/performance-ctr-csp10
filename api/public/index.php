<?php

declare(strict_types=1);

use Performance\Http\App;
use Performance\Http\Config;
use Performance\Http\Problem;
use Slim\Psr7\Factory\ServerRequestFactory;
use Slim\Psr7\Response;
use Slim\ResponseEmitter;

/*
 * Thin SAPI adapter of one PHP release (`app/<release>/public/index.php`). The
 * web root's `api/index.php` pointer requires it; the runtime configuration
 * lives in `config/runtime.php` beside the web root and the `app/` folder,
 * rendered by the deploy from GitHub secrets.
 */
$releaseRoot = dirname(__DIR__);
require $releaseRoot . '/vendor/autoload.php';

$scriptName = $_SERVER['SCRIPT_NAME'] ?? null;
$basePath = rtrim(dirname(is_string($scriptName) ? $scriptName : '/api/index.php', 2), '/');
$configFile = getenv('PERFORMANCE_CONFIG');
$configFile = is_string($configFile) && $configFile !== '' ? $configFile : dirname($releaseRoot, 2) . '/config/runtime.php';

try {
    $app = App::create(Config::load($configFile, $releaseRoot), $basePath);
    $response = $app->handle(ServerRequestFactory::createFromGlobals());
} catch (Throwable $failure) {
    error_log(sprintf('API start failed: %s', $failure->getMessage()));
    $response = Problem::internal()->write(new Response())->withHeader('Cache-Control', 'no-store');
}
(new ResponseEmitter())->emit($response);
