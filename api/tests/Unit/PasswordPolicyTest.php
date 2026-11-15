<?php

declare(strict_types=1);

namespace Performance\Tests\Unit;

use Performance\Domain\PasswordPolicy;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class PasswordPolicyTest extends TestCase
{
    /**
     * @return iterable<string, array{string}>
     */
    public static function tooShort(): iterable
    {
        yield 'empty' => [''];
        yield 'nine characters' => ['123456789'];
        yield 'nine umlauts are nine characters, not eighteen bytes' => ['äöüäöüäöü'];
    }

    #[DataProvider('tooShort')]
    public function testRejectsPasswordsShorterThanTenCharacters(string $password): void
    {
        self::assertSame('Mindestens 10 Zeichen.', PasswordPolicy::violation($password));
    }

    public function testAcceptsTenCharactersAndMore(): void
    {
        self::assertNull(PasswordPolicy::violation('1234567890'));
        self::assertNull(PasswordPolicy::violation('äöüäöüäöüä'));
        self::assertNull(PasswordPolicy::violation(str_repeat('x', 72)));
    }

    /**
     * @return iterable<string, array{string}>
     */
    public static function overBcryptsLimit(): iterable
    {
        yield '73 ASCII characters' => [str_repeat('x', 73)];
        yield 'the review: 72 bytes and a suffix bcrypt would ignore' => [str_repeat('a', 72) . 'new'];
        yield '37 umlauts are 74 bytes' => [str_repeat('ä', 37)];
        yield '19 emoji are 76 bytes' => [str_repeat('🍺', 19)];
    }

    #[DataProvider('overBcryptsLimit')]
    public function testRejectsPasswordsOver72BytesWhichBcryptWouldTruncate(string $password): void
    {
        self::assertSame('Höchstens 72 Byte (Umlaute zählen doppelt).', PasswordPolicy::violation($password));
    }

    public function testCountsBytesNotCharacters(): void
    {
        self::assertNull(PasswordPolicy::violation(str_repeat('ä', 36)), '36 umlauts are exactly 72 bytes');
        self::assertNull(PasswordPolicy::violation(str_repeat('🍺', 18)), '18 emoji are exactly 72 bytes');
    }

    public function testHashesWithPhpsDefaultAlgorithmSoTheHashVerifies(): void
    {
        $hash = PasswordPolicy::hash('richtig-langes-passwort');

        self::assertSame(PASSWORD_DEFAULT, password_get_info($hash)['algo']);
        self::assertTrue(password_verify('richtig-langes-passwort', $hash));
        self::assertFalse(password_verify('falsches-passwort', $hash));
    }

    public function testRejectsANulCharacterWhichTheHashCannotTake(): void
    {
        self::assertSame('Darf kein Nullzeichen enthalten.', PasswordPolicy::violation("abcdefghij\0kl"));
    }

    public function testTheHashForUnknownUsersCostsAsMuchAsARealOne(): void
    {
        $real = password_get_info(PasswordPolicy::hash('richtig-langes-passwort'));
        $unknown = password_get_info(PasswordPolicy::unknownUserHash());

        self::assertSame($real['algo'], $unknown['algo']);
        self::assertSame($real['options'], $unknown['options'], 'same cost, so an unknown user name answers as slowly as a wrong password');
        self::assertFalse(password_needs_rehash(PasswordPolicy::unknownUserHash(), PASSWORD_DEFAULT));
    }
}
