import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RuntimeConfig } from '../contract/runtime-config.ts';
import { renderRuntimeConfig } from './runtime-config.ts';

const config: RuntimeConfig = {
  db: {
    host: 'database-5012345678.webspace-host.com',
    name: 'dbs123',
    user: 'dbu123',
    password: String.raw`it's \' a \\ "pass" $word {$x} ?>`,
  },
  bootstrapAdmin: {
    user: "o'wner",
    passwordHash: '$2y$12$abcdefghijklmnopqrstuuJ0123456789abcdefghijklmnopqrs',
  },
};

describe('renderRuntimeConfig', () => {
  it('renders a PHP file that returns exactly the values, whatever they contain', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'runtime-config-'));
    try {
      const file = join(dir, 'runtime.php');
      await writeFile(file, renderRuntimeConfig(config));
      const result = spawnSync(
        'php',
        ['-r', 'echo json_encode(require $argv[1]);', file],
        { encoding: 'utf8' },
      );
      expect(result.stderr).toBe('');
      expect(JSON.parse(result.stdout)).toEqual(config);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('declares strict types and says where it comes from', () => {
    const rendered = renderRuntimeConfig(config);
    expect(rendered.startsWith('<?php\n\ndeclare(strict_types=1);\n')).toBe(
      true,
    );
    expect(rendered).toContain('Rendered by the deploy');
  });
});
