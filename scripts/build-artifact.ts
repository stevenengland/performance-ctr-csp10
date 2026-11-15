/*
Builds the one deployable artifact (PRD #1: tested bytes are shipped bytes):

  dist/artifact/
    web/                 the web root: SPA build + api/index.php pointer
    app/<release>/       the PHP release: src, migrations, public, vendor (--no-dev)
    release.json         app version, release folder, schema version
  dist/performance-<release>.tar.gz (+ .sha256)

The web root's .htaccess is rendered per target at deploy time
(`node deploy/cli.ts render-htaccess <site-url>`), so it is not part of the artifact.

APP_VERSION overrides the version (default `<web package version>+<short commit>`).
*/
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { env } from 'node:process';
import { apiPointer, releaseFolder, schemaVersion } from './artifact.ts';

const root = new URL('..', import.meta.url).pathname;
const out = join(root, 'dist');
const artifact = join(out, 'artifact');

function run(command: string, args: string[], extraEnv: Record<string, string> = {}) {
  execFileSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...env, ...extraEnv },
  });
}

function defaultVersion(): string {
  const pkg = JSON.parse(readFileSync(join(root, 'web/package.json'), 'utf8')) as {
    version: string;
  };
  const commit = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  return `${pkg.version}+${commit}`;
}

const appVersion = env.APP_VERSION ?? defaultVersion();
const release = releaseFolder(appVersion);
const migrations = readdirSync(join(root, 'api/migrations'));

rmSync(out, { recursive: true, force: true });
run('npm', ['run', 'build'], { APP_VERSION: appVersion });

const webRoot = join(artifact, 'web');
cpSync(join(root, 'web/dist'), webRoot, { recursive: true });
mkdirSync(join(webRoot, 'api'));
writeFileSync(join(webRoot, 'api/index.php'), apiPointer(release));

const releaseRoot = join(artifact, 'app', release);
for (const part of ['src', 'migrations', 'public', 'composer.json']) {
  cpSync(join(root, 'api', part), join(releaseRoot, part), { recursive: true });
}
try {
  cpSync(join(root, 'api/composer.lock'), join(releaseRoot, 'composer.lock'));
} catch {
  // No lock committed yet: Composer resolves the exact pins of composer.json.
}
run('composer', [
  'install',
  '--no-dev',
  '--classmap-authoritative',
  '--no-interaction',
  '--no-progress',
  `--working-dir=${releaseRoot}`,
]);
writeFileSync(
  join(releaseRoot, 'release.php'),
  `<?php\n\ndeclare(strict_types=1);\n\nreturn ['appVersion' => ${JSON.stringify(appVersion)}];\n`,
);
writeFileSync(
  join(artifact, 'release.json'),
  `${JSON.stringify({ appVersion, release, schemaVersion: schemaVersion(migrations) }, null, 2)}\n`,
);

// Reproducible archive: sorted names, fixed times and owners, no gzip timestamp.
const archive = join(out, `performance-${release}.tar.gz`);
execFileSync(
  'sh',
  [
    '-c',
    'tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner -C "$1" -cf - . | gzip -n > "$2"',
    'tar',
    artifact,
    archive,
  ],
  { stdio: 'inherit' },
);
const digest = createHash('sha256').update(readFileSync(archive)).digest('hex');
writeFileSync(`${archive}.sha256`, `${digest}  performance-${release}.tar.gz\n`);
console.log(`artifact ${archive}\nsha256 ${digest}`);
