<?php

declare(strict_types=1);

namespace Performance\Domain;

/**
 * The kinds of row the four-eyes rule applies to (PRD #61); the value is how the API and the
 * pending queue name them, and the queue orders rows of one instant by it.
 */
enum VerifiableKind: string
{
    case Entry = 'entry';
    case Match = 'match';
    case Result = 'result';

    /** How the audit log names a row of the kind. */
    public function subjectKind(): AuditSubjectKind
    {
        return match ($this) {
            self::Entry => AuditSubjectKind::Entry,
            self::Match => AuditSubjectKind::Match,
            self::Result => AuditSubjectKind::Result,
        };
    }
}
