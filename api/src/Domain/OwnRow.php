<?php

declare(strict_types=1);

namespace Performance\Domain;

use RuntimeException;

/** The acting account recorded the row itself, so another account has to verify it (PRD #61). */
final class OwnRow extends RuntimeException {}
