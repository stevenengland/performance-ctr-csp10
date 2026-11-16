import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';
import { sortedByPath } from '../contract/artifact.ts';
import type { ManifestEntry } from '../contract/artifact.ts';
import type { LocalFiles } from '../webspace/ports.ts';

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

async function walk(root: string, relative: string): Promise<ManifestEntry[]> {
  const entries = await readdir(join(root, relative), { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry): Promise<ManifestEntry[]> => {
      const path = posix.join(relative, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`artifact contains a symlink: ${path}`);
      }
      if (entry.isDirectory()) return walk(root, path);
      const absolute = join(root, path);
      const [bytes, info] = await Promise.all([
        readFile(absolute),
        stat(absolute),
      ]);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      return [{ path, size: info.size, sha256 }];
    }),
  );
  return nested.flat();
}

export const localFiles: LocalFiles = {
  async artifactFiles(webDir) {
    try {
      await readdir(webDir);
    } catch (error) {
      if (isMissing(error)) {
        throw new Error(`artifact has no web directory: ${webDir}`, {
          cause: error,
        });
      }
      throw error;
    }
    const files = await walk(webDir, '');
    return sortedByPath(files);
  },

  async readFile(path) {
    try {
      return await readFile(path, 'utf8');
    } catch (error) {
      if (isMissing(error)) return;
      throw error;
    }
  },

  async writeFile(path, content) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, 'utf8');
  },

  mkdtemp() {
    return mkdtemp(join(tmpdir(), 'deploy-'));
  },

  async remove(dir) {
    await rm(dir, { recursive: true, force: true });
  },
};
