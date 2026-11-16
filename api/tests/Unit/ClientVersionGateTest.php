<?php

declare(strict_types=1);

namespace Performance\Tests\Unit;

use ArrayObject;
use Performance\Http\ClientVersionGate;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\RequestHandlerInterface;
use Slim\Psr7\Factory\ResponseFactory;
use Slim\Psr7\Factory\ServerRequestFactory;

final class ClientVersionGateTest extends TestCase
{
    private const BASE_PATH = '/base';
    private const HEALTH = '/base/api/health';
    private const PHOTO = '/base/api/persons/12/photo';

    /** @var ArrayObject<int, string> paths the route behind the gate was asked to handle */
    private ArrayObject $handled;

    protected function setUp(): void
    {
        $this->handled = new ArrayObject();
    }

    /**
     * @return iterable<string, array{string}>
     */
    public static function clientsBelowTheFloor(): iterable
    {
        yield 'older patch' => ['0.2.0+abc1234'];
        yield 'older minor' => ['0.1.9'];
        yield 'older with a pre-release tag' => ['0.2.0-rc.1'];
        yield 'not a version' => ['latest'];
    }

    #[DataProvider('clientsBelowTheFloor')]
    public function testRefusesAClientBelowTheFloorBeforeTheRouteRuns(string $clientVersion): void
    {
        $gate = $this->gate(minClientVersion: '0.2.1');

        $response = $gate->process($this->request('POST', '/base/api/entries', $clientVersion), $this->route());

        self::assertSame([], $this->handled->getArrayCopy());
        self::assertSame(400, $response->getStatusCode());
        self::assertSame('application/problem+json', $response->getHeaderLine('Content-Type'));
        self::assertSame(
            ['type' => 'urn:performance:problem:client-outdated', 'title' => 'Diese Version ist veraltet. Bitte neu laden.', 'status' => 400],
            self::decoded($response),
        );
    }

    /**
     * @return iterable<string, array{string}>
     */
    public static function clientsAtOrAboveTheFloor(): iterable
    {
        yield 'the floor itself' => ['0.2.1'];
        yield 'the floor with build metadata' => ['0.2.1+abc1234'];
        yield 'newer patch' => ['0.2.2'];
        yield 'newer major' => ['1.0.0'];
        yield 'a minor that only sorts lower as text' => ['0.10.0'];
    }

    #[DataProvider('clientsAtOrAboveTheFloor')]
    public function testPassesAClientAtOrAboveTheFloorOnToTheRoute(string $clientVersion): void
    {
        $gate = $this->gate(minClientVersion: '0.2.1');

        $response = $gate->process($this->request('GET', '/base/api/games', $clientVersion), $this->route());

        self::assertSame(['/base/api/games'], $this->handled->getArrayCopy());
        self::assertSame(200, $response->getStatusCode());
    }

    public function testPassesAClientWithoutTheHeaderWhileTheFloorAllowsTheLastVersionThatSentNone(): void
    {
        $gate = $this->gate(minClientVersion: '0.1.0', lastVersionWithoutHeader: '0.1.0');

        $response = $gate->process($this->request('GET', '/base/api/games'), $this->route());

        self::assertSame(['/base/api/games'], $this->handled->getArrayCopy());
        self::assertSame(200, $response->getStatusCode());
    }

    public function testRefusesAClientWithoutTheHeaderOnceTheFloorPassesTheLastVersionThatSentNone(): void
    {
        $gate = $this->gate(minClientVersion: '0.2.0', lastVersionWithoutHeader: '0.1.0');

        $response = $gate->process($this->request('PUT', '/base/api/entries/x'), $this->route());

        self::assertSame([], $this->handled->getArrayCopy());
        self::assertSame(400, $response->getStatusCode());
        self::assertSame('urn:performance:problem:client-outdated', self::decoded($response)['type']);
    }

    public function testCountsAnEmptyHeaderAsNoHeader(): void
    {
        $passes = $this->gate(minClientVersion: '0.1.0', lastVersionWithoutHeader: '0.1.0');
        $refuses = $this->gate(minClientVersion: '0.2.0', lastVersionWithoutHeader: '0.1.0');

        self::assertSame(200, $passes->process($this->request('GET', '/base/api/games', ''), $this->route())->getStatusCode());
        self::assertSame(400, $refuses->process($this->request('GET', '/base/api/games', ''), $this->route())->getStatusCode());
    }

    public function testAlwaysLetsHealthThroughSoTheStartUpCheckAndTheDeployProbeKeepWorking(): void
    {
        $gate = $this->gate(minClientVersion: '9.0.0', lastVersionWithoutHeader: '0.1.0');

        $outdated = $gate->process($this->request('GET', self::HEALTH, '0.1.0'), $this->route());
        $withoutHeader = $gate->process($this->request('GET', self::HEALTH), $this->route());

        self::assertSame([self::HEALTH, self::HEALTH], $this->handled->getArrayCopy());
        self::assertSame(200, $outdated->getStatusCode());
        self::assertSame(200, $withoutHeader->getStatusCode());
    }

    /** An `<img>` sends no version, and the route only reads a version-addressed photo. */
    public function testAlwaysLetsAPersonsPhotoGetThroughSoImagesKeepLoadingAfterTheFloorRises(): void
    {
        $gate = $this->gate(minClientVersion: '9.0.0', lastVersionWithoutHeader: '0.1.0');

        $withoutHeader = $gate->process($this->request('GET', self::PHOTO), $this->route());
        $outdated = $gate->process($this->request('GET', self::PHOTO, '0.1.0'), $this->route());

        self::assertSame([self::PHOTO, self::PHOTO], $this->handled->getArrayCopy());
        self::assertSame(200, $withoutHeader->getStatusCode());
        self::assertSame(200, $outdated->getStatusCode());
    }

    /**
     * @return iterable<string, array{string, string}>
     */
    public static function requestsThatOnlyLookLikeAPhotoGet(): iterable
    {
        yield 'a photo upload' => ['PUT', self::PHOTO];
        yield 'a photo removal' => ['DELETE', self::PHOTO];
        yield 'a photo HEAD' => ['HEAD', self::PHOTO];
        yield 'the person' => ['GET', '/base/api/persons/12'];
        yield 'below the photo' => ['GET', '/base/api/persons/12/photo/x'];
        yield 'an id with a leading zero' => ['GET', '/base/api/persons/012/photo'];
        yield 'an id that is not a number' => ['GET', '/base/api/persons/x/photo'];
        yield 'outside the base path' => ['GET', '/api/persons/12/photo'];
    }

    #[DataProvider('requestsThatOnlyLookLikeAPhotoGet')]
    public function testRefusesAnythingElseOnceTheFloorPassesTheLastVersionThatSentNone(string $method, string $path): void
    {
        $gate = $this->gate(minClientVersion: '0.2.0', lastVersionWithoutHeader: '0.1.0');

        $response = $gate->process($this->request($method, $path), $this->route());

        self::assertSame([], $this->handled->getArrayCopy());
        self::assertSame(400, $response->getStatusCode());
    }

    /** The four-eyes release (PRD #61) retires the clients that send no header. */
    public function testTheShippedFloorRefusesClientsThatSendNoHeader(): void
    {
        $gate = new ClientVersionGate(new ResponseFactory(), self::BASE_PATH);

        $response = $gate->process($this->request('GET', '/base/api/games'), $this->route());

        self::assertSame([], $this->handled->getArrayCopy());
        self::assertSame(400, $response->getStatusCode());
    }

    private function gate(string $minClientVersion, string $lastVersionWithoutHeader = '0.1.0'): ClientVersionGate
    {
        return new ClientVersionGate(new ResponseFactory(), self::BASE_PATH, $minClientVersion, $lastVersionWithoutHeader);
    }

    private function request(string $method, string $path, ?string $clientVersion = null): ServerRequestInterface
    {
        $request = (new ServerRequestFactory())->createServerRequest($method, $path);

        return $clientVersion === null ? $request : $request->withHeader(ClientVersionGate::HEADER, $clientVersion);
    }

    /** The route behind the gate: notes the path it handled and answers 200. */
    private function route(): RequestHandlerInterface
    {
        return new class ($this->handled) implements RequestHandlerInterface {
            /** @param ArrayObject<int, string> $handled */
            public function __construct(private ArrayObject $handled) {}

            public function handle(ServerRequestInterface $request): ResponseInterface
            {
                $this->handled[] = $request->getUri()->getPath();

                return (new ResponseFactory())->createResponse(200);
            }
        };
    }

    /**
     * @return array<string, mixed>
     */
    private static function decoded(ResponseInterface $response): array
    {
        $decoded = json_decode((string) $response->getBody(), true, flags: JSON_THROW_ON_ERROR);
        self::assertIsArray($decoded);

        /** @var array<string, mixed> $decoded */
        return $decoded;
    }
}
