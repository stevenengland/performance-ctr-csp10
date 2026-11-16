<?php

declare(strict_types=1);

namespace Performance\Domain\Catalog;

use Performance\Domain\ValidationFailed;

/**
 * Turns uploaded JPEG bytes into the photo that is stored: walks the marker segments
 * and rewrites the file keeping only SOI, DQT, DHT, DRI, one SOF0/SOF1/SOF2 frame
 * header, each SOS with its scan data, and EOI. Every APPn and COM segment (EXIF, XMP,
 * ICC, JFIF, Adobe …) is dropped, so no stored photo carries metadata, whichever client
 * uploaded it.
 *
 * The walk proves structure, not that every scan decodes: scan data is copied as it is.
 */
final class CleanJpeg
{
    private const SIDE = 256;
    private const MAX_BYTES = 65_536;
    private const INVALID = 'Kein gültiges Foto (JPEG, 256 × 256, höchstens 64 KB).';

    private const SOI = "\xFF\xD8";
    private const EOI = "\xFF\xD9";
    private const MARKER_EOI = 0xD9;
    private const MARKER_SOS = 0xDA;
    /** DQT, DHT and DRI. */
    private const TABLES = [0xDB, 0xC4, 0xDD];
    /** Baseline, extended sequential and progressive, all Huffman-coded. */
    private const FRAMES = [0xC0, 0xC1, 0xC2];
    private const COM = 0xFE;
    private const APP0 = 0xE0;
    private const APP15 = 0xEF;
    /** RST0 to RST7 may sit inside scan data. */
    private const RST0 = 0xD0;
    private const RST7 = 0xD7;

    /**
     * @throws ValidationFailed on `image` when the bytes are not a 256 × 256 JPEG of
     *                          1 or 3 components that is at most 64 KiB once cleaned
     */
    public static function clean(string $bytes): string
    {
        $cleaned = self::rewrite($bytes);
        if ($cleaned === null || strlen($cleaned) > self::MAX_BYTES) {
            throw new ValidationFailed(['image' => self::INVALID]);
        }

        return $cleaned;
    }

    /** The JPEG with only its image data, or null when it is not one this app stores. */
    private static function rewrite(string $jpeg): ?string
    {
        if (!str_starts_with($jpeg, self::SOI)) {
            return null;
        }

        $cleaned = self::SOI;
        $hasFrame = false;
        $hasScan = false;
        $at = strlen(self::SOI);
        while (($marker = self::markerAt($jpeg, $at)) !== self::MARKER_EOI) {
            $end = self::segmentEnd($jpeg, $at);
            if ($marker === null || $end === null) {
                return null;
            }

            if (in_array($marker, self::FRAMES, true)) {
                if ($hasFrame || !self::isPhotoFrame(substr($jpeg, $at + 4, $end - $at - 4))) {
                    return null;
                }
                $hasFrame = true;
            } elseif ($marker === self::MARKER_SOS) {
                $end = $hasFrame ? self::scanEnd($jpeg, $end) : null;
                if ($end === null) {
                    return null;
                }
                $hasScan = true;
            } elseif (self::isMetadata($marker)) {
                $at = $end;
                continue;
            } elseif (!in_array($marker, self::TABLES, true)) {
                return null;
            }

            $cleaned .= substr($jpeg, $at, $end - $at);
            $at = $end;
        }

        $endsHere = $at + strlen(self::EOI) === strlen($jpeg);

        return $hasScan && $endsHere ? $cleaned . self::EOI : null;
    }

    /** The marker of the segment starting at `$at`, or null when no marker starts there. */
    private static function markerAt(string $jpeg, int $at): ?int
    {
        return $at + 1 < strlen($jpeg) && $jpeg[$at] === "\xFF" ? ord($jpeg[$at + 1]) : null;
    }

    /**
     * Where the segment starting at `$at` ends by its length field, or null when it is
     * truncated. A length below 2 needs no check: the next marker would then be read from
     * the length bytes, which cannot start with FF.
     */
    private static function segmentEnd(string $jpeg, int $at): ?int
    {
        if ($at + 4 > strlen($jpeg)) {
            return null;
        }

        $end = $at + 2 + ((ord($jpeg[$at + 2]) << 8) | ord($jpeg[$at + 3]));

        return $end <= strlen($jpeg) ? $end : null;
    }

    /**
     * Where the scan data from `$at` ends: at the first marker that is not a restart
     * marker (FF 00 is a stuffed data byte). Null when the data runs to the end.
     */
    private static function scanEnd(string $jpeg, int $at): ?int
    {
        while (($ff = strpos($jpeg, "\xFF", $at)) !== false && $ff + 1 < strlen($jpeg)) {
            $next = ord($jpeg[$ff + 1]);
            if ($next !== 0x00 && ($next < self::RST0 || $next > self::RST7)) {
                return $ff;
            }
            $at = $ff + 2;
        }

        return null;
    }

    /** A frame header body: precision, height, width, component count, then 3 bytes per component. */
    private static function isPhotoFrame(string $header): bool
    {
        if (strlen($header) < 6) {
            return false;
        }

        $height = (ord($header[1]) << 8) | ord($header[2]);
        $width = (ord($header[3]) << 8) | ord($header[4]);
        $components = ord($header[5]);

        return $height === self::SIDE
            && $width === self::SIDE
            && in_array($components, [1, 3], true)
            && strlen($header) === 6 + 3 * $components;
    }

    private static function isMetadata(int $marker): bool
    {
        return $marker === self::COM || ($marker >= self::APP0 && $marker <= self::APP15);
    }
}
