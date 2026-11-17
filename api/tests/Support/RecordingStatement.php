<?php

declare(strict_types=1);

namespace Performance\Tests\Support;

use PDOStatement;

/**
 * A statement class for `PDO::ATTR_STATEMENT_CLASS` that keeps every statement executed on its
 * connection with its parameters, so a test can EXPLAIN exactly what the code ran.
 */
final class RecordingStatement extends PDOStatement
{
    /** @var list<array{string, list<mixed>}> */
    public static array $executed = [];

    /** PDO requires a statement class without a public constructor. */
    protected function __construct() {}

    /**
     * @param array<mixed>|null $params
     */
    public function execute(?array $params = null): bool
    {
        self::$executed[] = [$this->queryString, array_values($params ?? [])];

        return parent::execute($params);
    }
}
