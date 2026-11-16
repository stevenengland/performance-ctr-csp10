<?php

declare(strict_types=1);

namespace Performance\Http;

use JsonException;
use Psr\Http\Message\ResponseFactoryInterface;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface;

/**
 * Request bodies must be JSON objects: anything else is 415 (no HTML form can post to
 * the API), malformed JSON is 400. The decoded object becomes the parsed body.
 */
final readonly class JsonBody implements MiddlewareInterface
{
    private const BODY_METHODS = ['POST', 'PUT', 'PATCH'];

    public function __construct(private ResponseFactoryInterface $responses) {}

    public function process(ServerRequestInterface $request, RequestHandlerInterface $handler): ResponseInterface
    {
        $body = (string) $request->getBody();
        if ($body === '' && !in_array($request->getMethod(), self::BODY_METHODS, true)) {
            return $handler->handle($request);
        }
        if (!self::isJson($request->getHeaderLine('Content-Type'))) {
            return Problem::unsupportedMediaType()->write($this->responses->createResponse());
        }
        try {
            $parsed = json_decode($body === '' ? '{}' : $body, true, 32, JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            $parsed = null;
        }
        if (!is_array($parsed)) {
            return Problem::badRequest()->write($this->responses->createResponse());
        }

        return $handler->handle($request->withParsedBody($parsed));
    }

    private static function isJson(string $contentType): bool
    {
        return strtolower(trim(explode(';', $contentType)[0])) === 'application/json';
    }
}
