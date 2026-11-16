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

    private static function fixture(string $name): string
    {
        $bytes = file_get_contents(__DIR__ . '/../Support/photos/' . $name);
        self::assertIsString($bytes, $name);

        return $bytes;
    }
}
