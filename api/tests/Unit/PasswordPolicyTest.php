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
        self::assertNull(PasswordPolicy::violation(str_repeat('x', 200)));
    }

    public function testHashesWithPhpsDefaultAlgorithmSoTheHashVerifies(): void
    {
        $hash = PasswordPolicy::hash('richtig-langes-passwort');

        self::assertSame(PASSWORD_DEFAULT, password_get_info($hash)['algo']);
        self::assertTrue(password_verify('richtig-langes-passwort', $hash));
        self::assertFalse(password_verify('falsches-passwort', $hash));
    }
}
