<?php

declare(strict_types=1);

namespace Performance\Http;

use Psr\Http\Message\ResponseInterface;

/**
 * An RFC 9457 problem with a stable type URI; its German title is what the UI shows.
 */
final readonly class Problem
{
    private const TYPE_PREFIX = 'urn:performance:problem:';

    public function __construct(
        public string $type,
        public string $title,
        public int $status,
    ) {}

    public static function notFound(): self
    {
        return new self('not-found', 'Nicht gefunden', 404);
    }

    public static function methodNotAllowed(): self
    {
        return new self('method-not-allowed', 'Methode nicht erlaubt', 405);
    }

    public static function internal(): self
    {
        return new self('internal', 'Interner Fehler', 500);
    }

    public static function maintenance(): self
    {
        return new self('maintenance', 'Wird aktualisiert – gleich wieder da', 503);
    }

    public static function migrationFailed(): self
    {
        return new self('migration-failed', 'Aktualisierung fehlgeschlagen', 503);
    }

    public function write(ResponseInterface $response): ResponseInterface
    {
        return Json::write(
            $response,
            ['type' => self::TYPE_PREFIX . $this->type, 'title' => $this->title, 'status' => $this->status],
            $this->status,
            'application/problem+json',
        );
    }
}
