<?php

declare(strict_types=1);

namespace Performance\Domain\Catalog;

final readonly class Person
{
    /**
     * @param string|null $photoVersion the version of the person's photo (lowercase hex SHA-256 of
     *                                  its stored bytes), null without a photo
     */
    public function __construct(
        public int $id,
        public string $name,
        public ?string $photoVersion,
    ) {}
}
