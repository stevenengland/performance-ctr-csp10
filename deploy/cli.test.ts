import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { targetPolicy } from './contract/policy.ts';
import { renderHtaccess } from './webspace/htaccess.ts';

function cli(...args: string[]) {
  return spawnSync(process.execPath, ['deploy/cli.ts', ...args], {
    encoding: 'utf8',
  });
}

describe('deploy cli', () => {
  it('prints the rendered .htaccess for a site URL', () => {
    const result = cli('render-htaccess', 'http://localhost:8080');
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(
      renderHtaccess(targetPolicy('http://localhost:8080')),
    );
  });

  it('rejects an invalid site URL without a stack trace', () => {
    const result = cli('render-htaccess', 'ftp://example.test');
    expect(result.status).toBe(1);
    expect(result.stderr).toBe(
      'Invalid site URL: expected an http:// or https:// URL without query or fragment\n',
    );
  });

  it('prints the usage for an unknown command', () => {
    const result = cli('deploy-everything');
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Usage: node deploy/cli.ts');
  });
});
