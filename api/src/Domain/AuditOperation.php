<?php

declare(strict_types=1);

namespace Performance\Domain;

/** What a change did to its subject; the value is how the database and the API name it. */
enum AuditOperation: string
{
    case Create = 'create';
    case Update = 'update';
    case Delete = 'delete';
    /** Another account let a pending row count (PRD #61). */
    case Verify = 'verify';
    /** Another account removed a pending row, so that it never counts (PRD #61). */
    case Reject = 'reject';
}
