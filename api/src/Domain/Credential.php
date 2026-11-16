<?php

declare(strict_types=1);

namespace Performance\Domain;

/**
 * A password that matched an account's hash when it was read. It counts only while
 * that hash is still the account's (see `Accounts::whileCredentialHolds`).
 */
final readonly class Credential
{
    public function __construct(
        public Account $account,
        public string $verifiedHash,
        /** A hash at the current default cost, when the stored one is outdated. */
        public ?string $rehash,
    ) {}
}
