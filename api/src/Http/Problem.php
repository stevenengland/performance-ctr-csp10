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

    /**
     * @param array<string, string> $errors field errors, keyed by the API field name
     */
    public function __construct(
        public string $type,
        public string $title,
        public int $status,
        public array $errors = [],
    ) {}

    public static function badRequest(): self
    {
        return new self('bad-request', 'Ungültige Anfrage', 400);
    }

    public static function unauthenticated(): self
    {
        return new self('unauthenticated', 'Nicht angemeldet', 401);
    }

    public static function invalidCredentials(): self
    {
        return new self('invalid-credentials', 'Benutzername oder Passwort falsch.', 401);
    }

    public static function forbidden(): self
    {
        return new self('forbidden', 'Nur für Admins', 403);
    }

    public static function duplicateUserName(): self
    {
        return new self('duplicate-user-name', 'Benutzername ist bereits vergeben.', 409);
    }

    public static function unsupportedMediaType(): self
    {
        return new self('unsupported-media-type', 'Nur JSON wird angenommen', 415);
    }

    /**
     * @param array<string, string> $errors
     */
    public static function validation(array $errors): self
    {
        return new self('validation', 'Bitte Eingaben prüfen', 422, $errors);
    }

    public static function tooManyAttempts(): self
    {
        return new self('too-many-attempts', 'Zu viele Versuche. Bitte später erneut.', 429);
    }

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
        $body = ['type' => self::TYPE_PREFIX . $this->type, 'title' => $this->title, 'status' => $this->status];
        if ($this->errors !== []) {
            $body['errors'] = $this->errors;
        }

        return Json::write(
            $response,
            $body,
            $this->status,
            'application/problem+json',
        );
    }
}
