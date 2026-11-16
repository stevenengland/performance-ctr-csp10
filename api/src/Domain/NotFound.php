<?php

declare(strict_types=1);

namespace Performance\Domain;

use RuntimeException;

/** The addressed item does not exist (any more). */
final class NotFound extends RuntimeException {}
