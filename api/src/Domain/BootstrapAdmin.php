<?php

declare(strict_types=1);

namespace Performance\Domain;

/**
 * The first admin, from the runtime configuration the deploy renders from GitHub
 * secrets: a user name and the output of `password_hash()`, never a password.
 */
final readonly class BootstrapAdmin
{
    public function __construct(
        public string $userName,
        public string $passwordHash,
    ) {}
}
