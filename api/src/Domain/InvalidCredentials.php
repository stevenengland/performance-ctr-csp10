<?php

declare(strict_types=1);

namespace Performance\Domain;

use RuntimeException;

/** Unknown user name or wrong password: deliberately indistinguishable. */
final class InvalidCredentials extends RuntimeException {}
