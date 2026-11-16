<?php

declare(strict_types=1);

namespace Performance\Domain\Catalog;

/**
 * Turns uploaded JPEG bytes into the photo that is stored: walks the marker segments
 * and rewrites the file keeping only the image data.
 */
final class CleanJpeg
{
    private const SOI = "\xFF\xD8";
    private const EOI = 0xD9;
    private const SOS = 0xDA;
    private const KEPT = [0xDB, 0xC4, 0xDD, 0xC0];

    public static function clean(string $bytes): string
    {
        $cleaned = self::SOI;
        $at = 2;
        while (ord($bytes[$at + 1]) !== self::EOI) {
            $marker = ord($bytes[$at + 1]);
            $end = $at + 2 + unpack('n', $bytes, $at + 2)[1];
            if ($marker === self::SOS) {
                $end = self::endOfScan($bytes, $end);
            }
            if ($marker === self::SOS || in_array($marker, self::KEPT, true)) {
                $cleaned .= substr($bytes, $at, $end - $at);
            }
            $at = $end;
        }

        return $cleaned . substr($bytes, $at, 2);
    }

    private static function endOfScan(string $bytes, int $at): int
    {
        while (!($bytes[$at] === "\xFF" && $bytes[$at + 1] !== "\x00" && (ord($bytes[$at + 1]) < 0xD0 || ord($bytes[$at + 1]) > 0xD7))) {
            $at++;
        }

        return $at;
    }
}
