/** Folder of a PHP release below `app/`: the version with build metadata joined by `-`. */
export function releaseFolder(appVersion: string): string {
  const folder = appVersion.replace('+', '-');
  if (!/^[0-9A-Za-z.-]+$/.test(folder)) {
    throw new Error(`Unusable app version for a release folder: ${appVersion}`);
  }
  return folder;
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
