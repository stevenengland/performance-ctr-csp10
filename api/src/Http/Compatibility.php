<?php

declare(strict_types=1);

namespace Performance\Http;

final class Compatibility
{
    /**
     * The oldest web client this API still serves. Raise it, and the `version` in
     * web/package.json with it, for a contract that older clients cannot use: an app that
     * starts below it shows the blocking "Bitte neu laden" dialog, and an app that is
     * already open gets that dialog on its next request, which `ClientVersionGate` refuses
     * unprocessed (ADR 0006, decision 3).
     */
    public const MIN_CLIENT_VERSION = '0.1.0';

    /**
     * The last web client that sent no `X-Client-Version`; every later one sends it. A
     * request without the header counts as this version, so it is served while
     * MIN_CLIENT_VERSION is at or below it and refused once the floor passes it.
     */
    public const LAST_VERSION_WITHOUT_HEADER = '0.1.0';
}
