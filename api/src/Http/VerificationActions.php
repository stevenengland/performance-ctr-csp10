<?php

declare(strict_types=1);

namespace Performance\Http;

use Performance\Domain\VerifiableKind;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;

/**
 * The four-eyes rule (PRD #61). `PUT /api/entries/{id}/verification`: another account than
 * the recorder lets a pending entry count; repeating it changes nothing.
 */
final readonly class VerificationActions
{
    public function __construct(private Database $database) {}

    /**
     * @param array{id: string} $arguments
     */
    public function verifyEntry(ServerRequestInterface $request, ResponseInterface $response, array $arguments): ResponseInterface
    {
        $this->database->verification()->verify(SessionAuth::actor($request), VerifiableKind::Entry, $arguments['id']);

        return $response->withStatus(204);
    }
}
