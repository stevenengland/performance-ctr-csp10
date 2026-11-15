<?php

declare(strict_types=1);

namespace Performance\Domain;

use RuntimeException;

/** The entry id was used before for different content. */
final class EntryConflict extends RuntimeException {}
