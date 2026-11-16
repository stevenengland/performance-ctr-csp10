<?php

declare(strict_types=1);

namespace Performance\Http;

use Performance\Domain\Account;

final class AccountJson
{
    /**
     * @return array{id: int, userName: string, isAdmin: bool}
     */
    public static function of(Account $account): array
    {
        return ['id' => $account->id, 'userName' => $account->userName, 'isAdmin' => $account->isAdmin];
    }
}
