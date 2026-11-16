<?php

declare(strict_types=1);

namespace Performance\Domain\Games;

/** How a game is played and ranked; fixed when the game is created. The value is how the database and the API name it. */
enum GameKind: string
{
    /** Two persons and an outcome: one wins, or a draw where the game allows it. */
    case Duel = 'duel';
    /** One person and a whole number of points; the sums rank, highest or lowest first. */
    case Points = 'points';
}
