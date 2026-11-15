<?php

declare(strict_types=1);

use Performance\Domain\Migration;

return new class implements Migration {
    public function isApplied(PDO $pdo): bool
    {
        return false;
    }

    public function apply(PDO $pdo): void
    {
        $pdo->exec('CREATE TABLE broken (id INT UNSIGNED NOT NULL PRIMARY KEY, id INT)');
    }
};
