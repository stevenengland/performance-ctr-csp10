<?php

declare(strict_types=1);

namespace Performance\Domain;

final readonly class Account
{
    public function __construct(
        public int $id,
        public string $userName,
        public bool $isAdmin,
    ) {}

    /**
     * @param array<mixed> $row an `accounts` row with `id`, `user_name` and `is_admin`
     */
    public static function fromRow(array $row): self
    {
        $id = $row['id'] ?? null;
        $userName = $row['user_name'] ?? null;

        return new self(
            is_numeric($id) ? (int) $id : 0,
            is_string($userName) ? $userName : '',
            (bool) ($row['is_admin'] ?? false),
        );
    }
}
