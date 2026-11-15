<?php

declare(strict_types=1);

namespace Performance\Domain;

/**
 * Passwords: at least ten characters, no NUL character (bcrypt cannot hash it),
 * hashed with PHP's default algorithm.
 */
final class PasswordPolicy
{
    public const MIN_LENGTH = 10;

    /**
     * Salt and hash of a random password that was thrown away, without the algorithm and
     * cost prefix; `unknownUserHash` adds the current default cost.
     */
    private const UNKNOWN_USER_SALT_AND_HASH = 'Wdlo7D986U3W5wuCoDcDAu8CEr7KJSGm4wklvd3t/GWbtV8p0Cpgi';

    /** The field error for a password that breaks the policy; null when it is fine. */
    public static function violation(string $password): ?string
    {
        if (str_contains($password, "\0")) {
            return 'Darf kein Nullzeichen enthalten.';
        }

        return mb_strlen($password, 'UTF-8') < self::MIN_LENGTH
            ? sprintf('Mindestens %d Zeichen.', self::MIN_LENGTH)
            : null;
    }

    /**
     * What an unknown user name is checked against, so it answers as slowly as a wrong
     * password: bcrypt at PHP's current default cost, which real hashes are rehashed to
     * on sign-in. Built rather than hashed per request, which would double its time.
     */
    public static function unknownUserHash(): string
    {
        return sprintf('$2y$%02d$%s', PASSWORD_BCRYPT_DEFAULT_COST, self::UNKNOWN_USER_SALT_AND_HASH);
    }

    public static function hash(string $password): string
    {
        return password_hash($password, PASSWORD_DEFAULT);
    }
}
