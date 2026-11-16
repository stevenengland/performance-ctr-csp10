import { createHash } from 'node:crypto';

/** Folder of a PHP release below `app/`: the version with build metadata joined by `-`. */
export function releaseFolder(appVersion: string): string {
  const folder = appVersion.replace('+', '-');
  if (!/^[0-9A-Za-z.-]+$/.test(folder)) {
    throw new Error(`Unusable app version for a release folder: ${appVersion}`);
  }
  return folder;
}

/**
The PHP release folder's name: the release plus a digest of its files (path and bytes,
in path order). A rebuild of the same commit with other bytes (say another vendor/)
gets another folder, so the deploy, which skips a folder that is already verified on
the host, never runs files this build did not test; identical bytes share the folder.
*/
export function appFolder(
  release: string,
  files: readonly { path: string; bytes: Uint8Array }[],
): string {
  const digest = createHash('sha256');
  for (const { path, bytes } of [...files].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  )) {
    const content = createHash('sha256').update(bytes).digest('hex');
    digest.update(`${path}\0${content}\n`);
  }
  return `${release}-${digest.digest('hex').slice(0, 12)}`;
}

/**
The web root's `api/index.php`: names the one PHP release that answers, so a
single request never mixes two releases. `app/` sits beside the web root.
*/
export function apiPointer(release: string): string {
  return `<?php\n\ndeclare(strict_types=1);\n\nrequire dirname(__DIR__, 2) . '/app/${release}/public/index.php';\n`;
}

/** The number of the newest migration file (`NNNN_snake_case.php`). */
export function schemaVersion(migrationFiles: readonly string[]): number {
  return Math.max(
    0,
    ...migrationFiles
      .map((file) => /^(\d{4})_[a-z0-9_]+\.php$/.exec(file)?.[1])
      .filter((number) => number !== undefined)
      .map(Number),
  );
}

/** `MIN_CLIENT_VERSION` of `api/src/Http/Compatibility.php`: the oldest client the API serves. */
export function minClientVersion(compatibilityPhp: string): string {
  const match = /MIN_CLIENT_VERSION = '([^']+)'/.exec(compatibilityPhp);
  if (!match?.[1])
    throw new Error('No MIN_CLIENT_VERSION in Compatibility.php');
  return match[1];
}

function core(version: string): number[] {
  const [release = ''] = version.split(/[+-]/, 1);
  return release.split('.').map((part) => Number.parseInt(part, 10) || 0);
}

/** Whether `version` is at least `floor`, comparing `MAJOR.MINOR.PATCH` as the client does. */
export function meetsFloor(version: string, floor: string): boolean {
  const [a, b] = [core(version), core(floor)];
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return true;
}
