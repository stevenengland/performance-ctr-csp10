/*
Checks that every PHP package is pinned to an exact version in api/composer.json,
transitive ones included, so `composer install` resolves the same tree everywhere even
without a committed composer.lock (see docs/adr/0002-walking-skeleton.md):

  node scripts/composer-pins.ts <folder with composer.json and vendor/>

Fails when a requirement is a range, or when vendor/composer/installed.json holds a
package that is not pinned or not at its pinned version.
*/
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { argv, exit, stderr } from 'node:process';

export interface ComposerJson {
  require?: Record<string, string>;
  'require-dev'?: Record<string, string>;
}

export interface InstalledPackage {
  name: string;
  version: string;
}

/** `php`, `ext-*` and `lib-*` are the platform, not packages. */
const isPlatform = (name: string) => /^(php|ext-.+|lib-.+)$/.test(name);
const EXACT = /^\d+\.\d+(\.\d+)?$/;
const bare = (version: string) => version.replace(/^v/, '');

export function pinProblems(
  composer: ComposerJson,
  installed: readonly InstalledPackage[],
): string[] {
  const pins = new Map(
    Object.entries({ ...composer.require, ...composer['require-dev'] }).filter(
      ([name]) => !isPlatform(name),
    ),
  );
  const problems: string[] = [];
  for (const [name, constraint] of pins) {
    if (!EXACT.test(constraint)) {
      problems.push(`${name}: "${constraint}" is not an exact version`);
    }
  }
  for (const { name, version } of installed) {
    const pin = pins.get(name);
    if (pin === undefined) {
      problems.push(`${name} ${version} is installed but not pinned`);
    } else if (EXACT.test(pin) && bare(version) !== pin) {
      problems.push(`${name}: pinned ${pin}, installed ${version}`);
    }
  }
  return problems;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

if (import.meta.main) {
  const folder = argv[2] ?? 'api';
  const { packages } = readJson(
    join(folder, 'vendor/composer/installed.json'),
  ) as { packages: InstalledPackage[] };
  const problems = pinProblems(
    readJson(join(folder, 'composer.json')) as ComposerJson,
    packages,
  );
  if (problems.length > 0) {
    stderr.write(
      `${problems.map((problem) => `composer pins: ${problem}`).join('\n')}\n`,
    );
    exit(1);
  }
}
