<?php

declare(strict_types=1);

namespace Performance\Http;

use Performance\Domain\Catalog\CleanJpeg;
use Performance\Domain\ValidationFailed;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;

/**
 * `/api/persons/{id}/photo`: set or replace a person's photo with `PUT {"image": "<base64 JPEG>"}`,
 * remove it with `DELETE`, read it with `GET ?v=<version>`. Any member may change any person's photo.
 */
final readonly class PersonPhotoActions
{
    /** The largest photo `PUT` body (96 KiB); BodyLimit refuses a larger one before it is parsed. */
    public const MAX_BODY_BYTES = 98_304;
    /** The base64 of the largest photo, 65 536 bytes; a longer `image` is refused before it is decoded. */
    private const MAX_IMAGE_LENGTH = 87_384;

    /** A version names its bytes for good: kept for a year, but only in the member's own browser. */
    private const CACHE_CONTROL = 'private, max-age=31536000, immutable';

    public function __construct(private Database $database) {}

    /**
     * The photo, only by its stored version `v`: any other `v`, or none, is 404 (never another
     * version's bytes), so the answer can be cached for good.
     *
     * @param array{id: string} $arguments
     */
    public function read(ServerRequestInterface $request, ResponseInterface $response, array $arguments): ResponseInterface
    {
        $jpeg = $this->database->personPhotos()->read((int) $arguments['id'], Query::text($request, 'v') ?? '');
        $response->getBody()->write($jpeg);

        return $response->withHeader('Content-Type', 'image/jpeg')->withHeader('Cache-Control', self::CACHE_CONTROL);
    }

    /**
     * @param array{id: string} $arguments
     */
    public function put(ServerRequestInterface $request, ResponseInterface $response, array $arguments): ResponseInterface
    {
        $id = (int) $arguments['id'];
        $this->database->personPhotos()->set(SessionAuth::actor($request), $id, self::jpeg(Input::text($request, 'image')));

        return Json::write($response, CatalogActions::person($this->database->catalog()->person($id)));
    }

    /**
     * @param array{id: string} $arguments
     */
    public function remove(ServerRequestInterface $request, ResponseInterface $response, array $arguments): ResponseInterface
    {
        $this->database->personPhotos()->remove(SessionAuth::actor($request), (int) $arguments['id']);

        return $response->withStatus(204);
    }

    /**
     * The bytes of a strict, canonical base64 text: only the base64 alphabet, padded, with no
     * whitespace (decoding and encoding again gives the same text).
     *
     * @throws ValidationFailed on `image` for a text over MAX_IMAGE_LENGTH or one that is not such base64
     */
    private static function jpeg(string $image): string
    {
        $jpeg = strlen($image) <= self::MAX_IMAGE_LENGTH ? base64_decode($image, true) : false;
        if ($jpeg === false || base64_encode($jpeg) !== $image) {
            throw new ValidationFailed(['image' => CleanJpeg::INVALID]);
        }

        return $jpeg;
    }
}
