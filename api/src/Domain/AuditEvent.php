<?php

declare(strict_types=1);

namespace Performance\Domain;

use DateTimeImmutable;

/**
 * One recorded change, as read back from the audit log. A snapshot holds the subject's values
 * with referenced names resolved when it was written; decimals are the domain's fixed-scale
 * strings (`"1.50"`). A reader treats a key it does not know, or one that is missing, as unknown.
 */
final readonly class AuditEvent
{
    /**
     * @param array<string, mixed>|null $before the values before the change; null for a create
     * @param array<string, mixed>|null $after  the values after the change; null for a delete
     * @param AuditCause|null           $cause  the event whose change caused this one; null for a direct change
     */
    public function __construct(
        public int $id,
        public DateTimeImmutable $occurredAt,
        public AuditOperation $operation,
        public AuditSubjectKind $subjectKind,
        public string $subjectId,
        public Actor $actor,
        public ?array $before,
        public ?array $after,
        public ?AuditCause $cause,
    ) {}
}
