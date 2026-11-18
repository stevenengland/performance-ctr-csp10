<?php

declare(strict_types=1);

namespace Performance\Domain\Games;

/**
 * What a game's standings cover when the query names no period: the game's current run, since
 * its last (re)start, as before the standings took a window. The other selections are an
 * Interval: a window or all time, whatever the run.
 */
final readonly class CurrentRun {}
