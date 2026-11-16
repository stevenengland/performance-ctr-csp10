<?php

declare(strict_types=1);

namespace Performance\Http;

use Psr\Http\Message\ResponseFactoryInterface;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Message\StreamFactoryInterface;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface;

/**
 * Refuses a request body over a byte limit with 413 before anything parses it: by its
 * `Content-Length`, and, whatever that says, by reading at most one byte past the limit. The
 * bytes it read are the body the route then sees. Runs before JsonBody on the routes it guards.
 */
final readonly class BodyLimit implements MiddlewareInterface
{
    public function __construct(
        private ResponseFactoryInterface $responses,
        private StreamFactoryInterface $streams,
        private int $maxBytes,
    ) {}

    public function process(ServerRequestInterface $request, RequestHandlerInterface $handler): ResponseInterface
    {
        if ((int) $request->getHeaderLine('Content-Length') > $this->maxBytes) {
            return $this->tooLarge();
        }
        $body = $request->getBody();
        if ($body->isSeekable()) {
            $body->rewind();
        }
        $read = '';
        while (strlen($read) <= $this->maxBytes && !$body->eof()) {
            $chunk = $body->read($this->maxBytes + 1 - strlen($read));
            if ($chunk === '') {
                break;
            }
            $read .= $chunk;
        }
        if (strlen($read) > $this->maxBytes) {
            return $this->tooLarge();
        }

        return $handler->handle($request->withBody($this->streams->createStream($read)));
    }

    private function tooLarge(): ResponseInterface
    {
        return Problem::contentTooLarge()->write($this->responses->createResponse());
    }
}
