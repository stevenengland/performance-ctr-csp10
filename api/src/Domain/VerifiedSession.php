<?php

declare(strict_types=1);

namespace Performance\Domain;

/** A valid session's account, and whether this request renewed the session (then its cookie is renewed too). */
final readonly class VerifiedSession
{
    public function __construct(
        public Account $account,
        public bool $renewed,
    ) {}
}
