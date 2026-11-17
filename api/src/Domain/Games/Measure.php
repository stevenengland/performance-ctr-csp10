<?php

declare(strict_types=1);

namespace Performance\Domain\Games;

/**
 * What ranks a points game's standings over a window or all time: the sum of each person's
 * verified points, or their average per verified result. The current run ranks by the sum.
 */
enum Measure: string
{
    case Sum = 'sum';
    case Average = 'average';
}
