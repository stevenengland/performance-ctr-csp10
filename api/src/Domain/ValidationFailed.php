<?php

declare(strict_types=1);

namespace Performance\Domain;

use RuntimeException;

/**
 * Input that breaks a rule; the errors are keyed by the API field name and are shown as they are.
 */
final class ValidationFailed extends RuntimeException
{
    /**
     * @param non-empty-array<string, string> $errors
     */
    public function __construct(public readonly array $errors)
    {
        parent::__construct('Validation failed: ' . implode(', ', array_keys($errors)));
    }
}
