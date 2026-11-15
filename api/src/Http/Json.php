<?php

declare(strict_types=1);

namespace Performance\Http;

use Psr\Http\Message\ResponseInterface;

final class Json
{
    /**
     * @param array<string, mixed> $data
     */
    public static function write(
        ResponseInterface $response,
        array $data,
        int $status = 200,
        string $contentType = 'application/json',
    ): ResponseInterface {
        $response->getBody()->write(json_encode($data, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));

        return $response->withStatus($status)->withHeader('Content-Type', $contentType);
    }
}
