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
    // The tests' bootstrap admin (e2e/support/session.ts): password `e2e-admin-passwort`.
    'bootstrapAdmin' => [
        'user' => 'e2e-admin',
        'passwordHash' => '$2y$10$fMq7NuJ28KLZAIivrA0lreVAmGvK06ppWWLf1d2BQQA5I29ieKcI2',
    ],
];
