<?php

declare(strict_types=1);

namespace Performance\Domain;

/**
 * Passwords: at least ten characters, hashed with PHP's default algorithm.
 */
final class PasswordPolicy
{
    public const MIN_LENGTH = 10;

    /** The field error for a password that breaks the policy; null when it is fine. */
    public static function violation(string $password): ?string
    {
        return mb_strlen($password, 'UTF-8') < self::MIN_LENGTH
            ? sprintf('Mindestens %d Zeichen.', self::MIN_LENGTH)
            : null;
    }

    public static function hash(string $password): string
    {
        return password_hash($password, PASSWORD_DEFAULT);
    }
}
