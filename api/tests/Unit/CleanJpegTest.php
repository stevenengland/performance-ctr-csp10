<?php

declare(strict_types=1);

namespace Performance\Tests\Unit;

use Performance\Domain\Catalog\CleanJpeg;
use PHPUnit\Framework\TestCase;

/**
 * The fixtures under tests/Support/photos are made by make-fixtures.py there.
 */
final class CleanJpegTest extends TestCase
{
    private const START_OF_SCAN = "\xFF\xDA";

    public function testKeepsOnlyTheImageDataOfAJpegThatCarriesMetadata(): void
    {
        $withMetadata = self::fixture('metadata.jpg');

        $cleaned = CleanJpeg::clean($withMetadata);

        self::assertSame(self::fixture('metadata-cleaned.jpg'), $cleaned, 'SOI, DQT, DHT, DRI, SOF0, SOS with its scan data and EOI, byte for byte');
        foreach (['JFIF', 'Exif', 'ICC_PROFILE', 'http://ns.adobe.com/xap/1.0/', 'Kommentar'] as $metadata) {
            self::assertStringContainsString($metadata, $withMetadata);
            self::assertStringNotContainsString($metadata, $cleaned);
        }
    }

    public function testKeepsEveryScanOfAProgressiveJpeg(): void
    {
        $progressive = self::fixture('progressive.jpg');

        $cleaned = CleanJpeg::clean($progressive);

        self::assertSame(10, substr_count($cleaned, self::START_OF_SCAN), 'stuffing keeps FF DA out of scan data, so this counts the scans');
        self::assertSame(self::withoutJfifHeader($progressive), $cleaned);
    }

    /** Pillow writes the 18-byte JFIF segment right after SOI; it is the only metadata in its files. */
    private static function withoutJfifHeader(string $jpeg): string
    {
        self::assertSame("\xFF\xE0\x00\x10JFIF\x00", substr($jpeg, 2, 9));

        return substr($jpeg, 0, 2) . substr($jpeg, 20);
    }

    private static function fixture(string $name): string
    {
        $bytes = file_get_contents(__DIR__ . '/../Support/photos/' . $name);
        self::assertIsString($bytes, $name);

        return $bytes;
    }
}
