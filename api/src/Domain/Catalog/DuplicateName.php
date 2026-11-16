<?php

declare(strict_types=1);

namespace Performance\Domain\Catalog;

use RuntimeException;

/** A person or drink of that name exists already, ignoring case. */
final class DuplicateName extends RuntimeException {}
