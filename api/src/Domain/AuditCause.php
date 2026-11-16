<?php

declare(strict_types=1);

namespace Performance\Domain;

/**
 * The event whose change caused a consequential event, as far as a reader needs it to name the
 * cause without loading it: its id, its subject kind and the subject's name as that event kept it.
 */
final readonly class AuditCause
{
    public function __construct(
        public int $id,
        public AuditSubjectKind $subjectKind,
        public string $name,
    ) {}
}
