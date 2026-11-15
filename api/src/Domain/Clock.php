<?php

declare(strict_types=1);

namespace Performance\Domain;

use DateTimeImmutable;

/**
 * The current instant, in UTC. Injected so tests can let time pass.
 */
interface Clock
{
    public function now(): DateTimeImmutable;
}
