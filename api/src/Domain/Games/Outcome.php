<?php

declare(strict_types=1);

namespace Performance\Domain\Games;

/** How a match ended, from the first person's side; the value is how the database and the API name it. */
enum Outcome: string
{
    case First = 'first';
    case Second = 'second';
    case Draw = 'draw';
}
