<?php

declare(strict_types=1);

// Runtime configuration of the e2e stack; the deploy renders the real one from secrets.
return [
    'db' => [
        'host' => getenv('STACK_DB_HOST') ?: 'db',
        'port' => (int) (getenv('STACK_DB_PORT') ?: 3306),
        'name' => 'performance',
        'user' => 'performance',
        'password' => 'performance',
    ],
];
