<?php

declare(strict_types=1);

namespace Performance\Http;

final class Compatibility
{
    /**
     * The oldest web client this API still serves. Raise it with a breaking API change;
     * older installed apps then show the blocking "Bitte neu laden" dialog.
     */
    public const MIN_CLIENT_VERSION = '0.1.0';
}
