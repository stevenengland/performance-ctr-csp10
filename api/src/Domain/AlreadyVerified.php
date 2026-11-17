<?php

declare(strict_types=1);

namespace Performance\Domain;

use RuntimeException;

/** The row counts already, so it can no longer be rejected; only deleted (PRD #61). */
final class AlreadyVerified extends RuntimeException {}
