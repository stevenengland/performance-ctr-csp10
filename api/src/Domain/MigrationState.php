<?php

declare(strict_types=1);

namespace Performance\Domain;

enum MigrationState: string
{
    /** The schema matches the code. */
    case Ok = 'ok';
    /** Another request is applying migrations right now. */
    case Running = 'running';
    /** A migration failed; the schema is behind the code until a fixed release runs it. */
    case Failed = 'failed';
}
