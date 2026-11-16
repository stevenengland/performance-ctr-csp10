<?php

declare(strict_types=1);

namespace Performance\Domain;

/** The kind of row an audit event is about; the value is how the database and the API name it. */
enum AuditSubjectKind: string
{
    case Entry = 'entry';
    case Person = 'person';
    case Drink = 'drink';
    case Factor = 'factor';
}
