<?php

declare(strict_types=1);

namespace Performance\Domain;

/**
 * A row its owner locked for a verification: who recorded it, whether it still waits, and the
 * row as the audit log keeps it.
 */
final readonly class VerifiableRow
{
    /**
     * @param int|null             $recorderAccountId null once the recording account was deleted (recorder unknown)
     * @param array<string, mixed> $snapshot          the owner's audit snapshot of the row, its pending state included
     */
    public function __construct(
        public ?int $recorderAccountId,
        public bool $pending,
        public array $snapshot,
    ) {}
}
