<?php

declare(strict_types=1);

namespace Performance\Tests\Unit;

use Performance\Domain\Catalog\CleanJpeg;
use Performance\Domain\ValidationFailed;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use RuntimeException;

/**
 * The fixtures under tests/Support/photos are made by make-fixtures.py there.
 */
final class CleanJpegTest extends TestCase
{
    private const START_OF_SCAN = "\xFF\xDA";
    /** SOF0 and the length of a three-component frame header. */
    private const FRAME_HEADER = "\xFF\xC0\x00\x11";

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

        $scans = substr_count($progressive, self::START_OF_SCAN);
        self::assertGreaterThan(1, $scans, 'stuffing keeps FF DA out of scan data, so this counts the scans');
        self::assertSame($scans, substr_count($cleaned, self::START_OF_SCAN));
        self::assertSame(self::withoutJfifHeader($progressive), $cleaned);
    }

    /**
     * @return iterable<string, array{string}>
     */
    public static function validPhotos(): iterable
    {
        yield 'baseline with metadata' => [self::fixture('metadata.jpg')];
        yield 'extended sequential (SOF1)' => [self::withFrameMarker(self::fixture('metadata-cleaned.jpg'), "\xC1")];
        yield 'progressive' => [self::fixture('progressive.jpg')];
        yield 'one component' => [self::fixture('grayscale.jpg')];
    }

    #[DataProvider('validPhotos')]
    public function testLeavesAnAlreadyCleanJpegAsItIsSoItsVersionStaysTheSame(string $jpeg): void
    {
        $clean = CleanJpeg::clean($jpeg);

        $again = CleanJpeg::clean($clean);

        self::assertSame($clean, $again);
        self::assertSame(hash('sha256', $clean), hash('sha256', $again));
    }

    /**
     * @return iterable<string, array{string}>
     */
    public static function invalidPhotos(): iterable
    {
        $clean = self::fixture('metadata-cleaned.jpg');
        $frame = substr($clean, (int) strpos($clean, self::FRAME_HEADER), 19);
        $scan = (int) strpos($clean, self::START_OF_SCAN);

        yield 'empty' => [''];
        yield 'not a JPEG' => ["GIF89a\x01\x00\x01\x00\x00\x00\x00;"];
        yield 'nothing after SOI' => [substr($clean, 0, 2)];
        yield 'a truncated segment' => [substr(self::fixture('metadata.jpg'), 0, 100)];
        yield 'a segment length below two' => ["\xFF\xD8\xFF\xDB\x00\x01" . substr($clean, 2)];
        yield 'a missing EOI' => [substr($clean, 0, -2)];
        yield 'bytes after EOI' => [$clean . "\x00"];
        yield 'a lossless frame (SOF3)' => [self::withFrameMarker($clean, "\xC3")];
        yield 'arithmetic coding (SOF9)' => [self::withFrameMarker($clean, "\xC9")];
        yield 'a frame header longer than its component count needs' => [str_replace(self::FRAME_HEADER . "\x08\x01\x00\x01\x00\x03", self::FRAME_HEADER . "\x08\x01\x00\x01\x00\x01", $clean)];
        yield 'an empty frame header' => [str_replace($frame, "\xFF\xC0\x00\x02", $clean)];
        yield 'a second frame' => [substr($clean, 0, $scan) . $frame . substr($clean, $scan)];
        yield 'a scan before the frame' => [substr($clean, 0, 2) . substr($clean, $scan)];
        yield 'no scan' => [substr($clean, 0, $scan) . "\xFF\xD9"];
        yield 'another marker (DNL)' => [substr($clean, 0, -2) . "\xFF\xDC\x00\x04\x01\x00\xFF\xD9"];
        yield '256 × 192' => [self::fixture('not-square.jpg')];
        yield 'four components (CMYK)' => [self::fixture('cmyk.jpg')];
        yield 'over 65 536 bytes after cleaning' => [self::fixture('oversized.jpg')];
    }

    #[DataProvider('invalidPhotos')]
    public function testRejectsAnythingButA256By256JpegOfAtMost64KibWithAFieldErrorOnImage(string $bytes): void
    {
        try {
            CleanJpeg::clean($bytes);
            self::fail('cleaned, though it is not a valid photo');
        } catch (ValidationFailed $rejected) {
            self::assertSame(['image' => 'Kein gültiges Foto (JPEG, 256 × 256, höchstens 64 KB).'], $rejected->errors);
        }
    }

    private static function withFrameMarker(string $jpeg, string $marker): string
    {
        return str_replace(self::FRAME_HEADER, "\xFF" . $marker . substr(self::FRAME_HEADER, 2), $jpeg);
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

        return $bytes !== false ? $bytes : throw new RuntimeException("Missing fixture {$name}");
    }
}
