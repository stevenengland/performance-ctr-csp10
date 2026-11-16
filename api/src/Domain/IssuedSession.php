<?php

declare(strict_types=1);

namespace Performance\Domain;

/**
 * A new session: the token goes to the client once and is never stored.
 */
final readonly class IssuedSession
{
    public function __construct(
        public string $token,
        public Account $account,
    ) {}
}
