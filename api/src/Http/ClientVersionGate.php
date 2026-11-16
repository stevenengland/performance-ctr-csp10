<?php

declare(strict_types=1);

namespace Performance\Http;

use Psr\Http\Message\ResponseFactoryInterface;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface;

/**
 * Refuses a web client below the floor before its request reaches a route, so a client
 * that was open across a deploy learns on its next request that it must reload, and the
 * request changes nothing. The client sends its version in `X-Client-Version`; a request
 * without it counts as the last version that sent none. Health always answers: the client
 * reads the floor there when it starts, and the deploy probes it.
 */
final readonly class ClientVersionGate implements MiddlewareInterface
{
    public const HEADER = 'X-Client-Version';

    public function __construct(
        private ResponseFactoryInterface $responses,
        private string $healthPath,
        private string $minClientVersion = Compatibility::MIN_CLIENT_VERSION,
        private string $lastVersionWithoutHeader = Compatibility::LAST_VERSION_WITHOUT_HEADER,
    ) {}

    public function process(ServerRequestInterface $request, RequestHandlerInterface $handler): ResponseInterface
    {
        if ($request->getUri()->getPath() === $this->healthPath) {
            return $handler->handle($request);
        }
        $clientVersion = $request->getHeaderLine(self::HEADER);
        if ($clientVersion === '') {
            $clientVersion = $this->lastVersionWithoutHeader;
        }
        if (self::isOlder($clientVersion, $this->minClientVersion)) {
            return Problem::clientOutdated()->write($this->responses->createResponse());
        }

        return $handler->handle($request);
    }

    /** Compares `MAJOR.MINOR.PATCH` as the web client does; build metadata and pre-release tags do not count. */
    private static function isOlder(string $version, string $minimum): bool
    {
        return version_compare(self::core($version), self::core($minimum), '<');
    }

    private static function core(string $version): string
    {
        $release = explode('+', strtr($version, '-', '+'), 2)[0];
        $parts = explode('.', $release);
        $numbers = array_map(static fn(string $part): int => (int) $part, array_slice(array_pad($parts, 3, '0'), 0, 3));

        return implode('.', $numbers);
    }
}
