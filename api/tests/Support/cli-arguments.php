<?php

declare(strict_types=1);

/*
 * The arguments of a helper script that PHPUnit starts as its own process. They are read
 * from `$_SERVER['argv']` and checked, not taken from the global `$argv`: PHP 8.5 reports
 * `register_argc_argv` as off, and PHPStan then treats that global as possibly undefined.
 */

/**
 * @return list<string> exactly `$count` arguments, without the script name
 */
function cliArguments(int $count): array
{
    $argv = $_SERVER['argv'] ?? null;
    if (!is_array($argv)) {
        throw new RuntimeException('This script must be started from the command line.');
    }
    $arguments = [];
    foreach (array_slice(array_values($argv), 1) as $argument) {
        if (!is_string($argument)) {
            throw new RuntimeException('Command line arguments must be strings.');
        }
        $arguments[] = $argument;
    }
    if (count($arguments) !== $count) {
        throw new RuntimeException(sprintf('Expected %d arguments, got %d.', $count, count($arguments)));
    }

    return $arguments;
}
