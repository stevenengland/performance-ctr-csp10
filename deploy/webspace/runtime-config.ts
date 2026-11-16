import type { RuntimeConfig } from '../contract/runtime-config.ts';

/** A PHP single-quoted string literal: only the backslash and the quote need escaping. */
function phpString(value: string): string {
  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", String.raw`\'`)}'`;
}

/**
The API's runtime configuration file (`config/runtime.php` beside the web root),
read by `api/src/Http/Config.php`. Rendered on every deploy, so rotating a
secret takes a deploy and nothing else.
*/
export function renderRuntimeConfig(config: RuntimeConfig): string {
  const { db, bootstrapAdmin } = config;
  return [
    '<?php',
    '',
    'declare(strict_types=1);',
    '',
    '// Rendered by the deploy from GitHub secrets on every deploy. Do not edit on the server.',
    'return [',
    "    'db' => [",
    `        'host' => ${phpString(db.host)},`,
    `        'name' => ${phpString(db.name)},`,
    `        'user' => ${phpString(db.user)},`,
    `        'password' => ${phpString(db.password)},`,
    '    ],',
    "    'bootstrapAdmin' => [",
    `        'user' => ${phpString(bootstrapAdmin.user)},`,
    `        'passwordHash' => ${phpString(bootstrapAdmin.passwordHash)},`,
    '    ],',
    '];',
    '',
  ].join('\n');
}
