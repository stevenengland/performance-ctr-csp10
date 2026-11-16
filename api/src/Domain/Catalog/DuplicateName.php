<?php

declare(strict_types=1);

namespace Performance\Domain\Catalog;

use RuntimeException;

/** A person, drink, factor or game of that name exists already, ignoring case (each kind has names of its own). */
final class DuplicateName extends RuntimeException {}
