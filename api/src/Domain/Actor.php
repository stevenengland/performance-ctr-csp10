<?php

declare(strict_types=1);

namespace Performance\Domain;

/**
 * The signed-in account a write is done by, as the audit log keeps it: its id and its user
 * name at the time, so an event still names the account after it was renamed or deleted.
 */
final readonly class Actor
{
    public function __construct(
        public int $accountId,
        public string $userName,
    ) {}

    public static function of(Account $account): self
    {
        return new self($account->id, $account->userName);
    }
}
