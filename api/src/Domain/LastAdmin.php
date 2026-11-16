<?php

declare(strict_types=1);

namespace Performance\Domain;

use RuntimeException;

/** The change would demote or delete the last remaining admin. */
final class LastAdmin extends RuntimeException {}
