<?php

declare(strict_types=1);

namespace Performance\Domain;

/**
 * One page of the audit log, newest first, and where the next older page starts.
 */
final readonly class AuditPage
{
    /**
     * @param list<AuditEvent> $events newest first, by id
     * @param int|null         $next   the `before` of the next older page; null when no older event exists
     */
    public function __construct(
        public array $events,
        public ?int $next,
    ) {}
}
