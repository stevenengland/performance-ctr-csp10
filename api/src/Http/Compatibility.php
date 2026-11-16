<?php

declare(strict_types=1);

namespace Performance\Http;

final class Compatibility
{
    /**
     * The oldest web client this API still serves. Raise it with a new contract that older
     * clients cannot use; an older app shows the blocking "Bitte neu laden" dialog when it
     * starts. An app already open does not check it again, so the old contract stays served
     * (ADR 0006, decision 3).
     */
    public const MIN_CLIENT_VERSION = '0.1.0';
}
