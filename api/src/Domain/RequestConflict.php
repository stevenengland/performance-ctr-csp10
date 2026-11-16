<?php

declare(strict_types=1);

namespace Performance\Domain;

use RuntimeException;

/** A retry key was used before for a request with different content. */
final class RequestConflict extends RuntimeException {}
