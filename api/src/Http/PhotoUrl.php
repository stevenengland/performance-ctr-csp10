<?php

declare(strict_types=1);

namespace Performance\Http;

/**
 * Builds the only URLs a person's photo is served at: under the API's base path, naming the
 * photo's version (`<basePath>/api/persons/{id}/photo?v=<version>`). Clients use them as they
 * are and never compose one.
 */
final readonly class PhotoUrl
{
    /** @param string $basePath the path the API is installed under, '' at the web root */
    public function __construct(private string $basePath) {}

    /** The URL of the person's photo of that version, or null for a person without a photo. */
    public function of(int $personId, ?string $version): ?string
    {
        return $version === null ? null : "{$this->basePath}/api/persons/{$personId}/photo?v={$version}";
    }
}
