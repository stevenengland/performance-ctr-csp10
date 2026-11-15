import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { localFiles } from './fs.ts';

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fs-test-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('localFiles.artifactFiles', () => {
  it('lists every regular file with its size and sha256, sorted by path', async () => {
    await mkdir(join(dir, 'web/impressum'), { recursive: true });
    await mkdir(join(dir, 'web/assets'), { recursive: true });
    await writeFile(join(dir, 'web/index.html'), 'home');
    await writeFile(join(dir, 'web/impressum/index.html'), 'impressum');
    await writeFile(join(dir, 'web/assets/a.css'), 'css');
    expect(await localFiles.artifactFiles(join(dir, 'web'))).toEqual([
      { path: 'assets/a.css', size: 3, sha256: sha('css') },
      { path: 'impressum/index.html', size: 9, sha256: sha('impressum') },
      { path: 'index.html', size: 4, sha256: sha('home') },
    ]);
  });

  it('rejects symlinks and a missing web directory', async () => {
    await mkdir(join(dir, 'web'));
    await writeFile(join(dir, 'outside.txt'), 'x');
    await symlink(join(dir, 'outside.txt'), join(dir, 'web/link.txt'));
    await expect(localFiles.artifactFiles(join(dir, 'web'))).rejects.toThrow(
      /symlink: link\.txt/,
    );
    await expect(localFiles.artifactFiles(join(dir, 'nope'))).rejects.toThrow(
      /no web directory/,
    );
  });
});

describe('localFiles temp helpers', () => {
  it('reads undefined for a missing file and round-trips writes', async () => {
    expect(
      await localFiles.readFile(join(dir, 'missing.json')),
    ).toBeUndefined();
    await localFiles.writeFile(join(dir, 'nested/out.txt'), 'hello');
    expect(await localFiles.readFile(join(dir, 'nested/out.txt'))).toBe(
      'hello',
    );
    const temp = await localFiles.mkdtemp();
    expect(temp).toMatch(/deploy-/);
    await localFiles.remove(temp);
    expect(await localFiles.readFile(join(temp, 'x'))).toBeUndefined();
  });
});
