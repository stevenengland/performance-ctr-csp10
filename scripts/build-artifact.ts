/*
Builds the one deployable artifact (PRD #1: tested bytes are shipped bytes):

  dist/artifact/
    web/                 the web root: SPA build + api/index.php pointer
    app/<release>-<digest>/  the PHP release: src, migrations, public, vendor (--no-dev),
                         named after its content (scripts/artifact.ts appFolder)
    release.json         app version, release folder, schema version
    manifest.json        the deploy manifest of web/ and app/<release>/ (deploy/cli.ts manifest)
  dist/performance-<release>.tar.gz (+ .sha256)

The web root's .htaccess is rendered per target at deploy time
(`node deploy/cli.ts render-htaccess <site-url>`), so it is not part of the artifact.

APP_VERSION overrides the version (default `<web package version>+<short commit>`).
The manifest takes the commit and run from GITHUB_SHA, GITHUB_RUN_ID and
GITHUB_RUN_ATTEMPT (Actions sets them; a local build uses HEAD and run `local`).
*/
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, relative } from 'node:path';
import { env } from 'node:process';
import {
  apiPointer,
  appFolder,
  meetsFloor,
  minClientVersion,
  releaseFolder,
  schemaVersion,
} from './artifact.ts';

const root = new URL('..', import.meta.url).pathname;
const out = join(root, 'dist');
const artifact = join(out, 'artifact');

function run(
  command: string,
  args: string[],
  extraEnv: Record<string, string> = {},
) {
  execFileSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...env, ...extraEnv },
  });
}

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function defaultVersion(): string {
  const pkg = JSON.parse(
    readFileSync(join(root, 'web/package.json'), 'utf8'),
  ) as {
    version: string;
  };
  return `${pkg.version}+${git('rev-parse', '--short=7', 'HEAD')}`;
}

const appVersion = env.APP_VERSION ?? defaultVersion();
const release = releaseFolder(appVersion);
const floor = minClientVersion(
  readFileSync(join(root, 'api/src/Http/Compatibility.php'), 'utf8'),
);
if (!meetsFloor(appVersion, floor)) {
  // The shipped client would be below its own API's floor and ask to reload forever.
  throw new Error(
    `App version ${appVersion} is below MIN_CLIENT_VERSION ${floor}: bump web/package.json`,
  );
}
const migrations = readdirSync(join(root, 'api/migrations'));

rmSync(out, { recursive: true, force: true });
run('npm', ['run', 'build'], { APP_VERSION: appVersion });

const webRoot = join(artifact, 'web');
cpSync(join(root, 'web/dist'), webRoot, { recursive: true });

// Built under a temporary name, then named after its content (appFolder).
const releaseRoot = join(artifact, 'app', '.building');
for (const part of ['src', 'migrations', 'public', 'composer.json']) {
  cpSync(join(root, 'api', part), join(releaseRoot, part), { recursive: true });
}
try {
  cpSync(join(root, 'api/composer.lock'), join(releaseRoot, 'composer.lock'));
} catch {
  // No lock committed yet (Packagist was unreachable where the API was written; ADR
  // 0002): composer.json pins every package, transitive ones included, exactly, and
  // the pin check below fails the build if anything resolves to an unpinned version.
}
run('composer', [
  'install',
  '--no-dev',
  '--classmap-authoritative',
  '--no-interaction',
  '--no-progress',
  `--working-dir=${releaseRoot}`,
]);
run(process.execPath, ['scripts/composer-pins.ts', releaseRoot]);
writeFileSync(
  join(releaseRoot, 'release.php'),
  `<?php\n\ndeclare(strict_types=1);\n\nreturn ['appVersion' => ${JSON.stringify(appVersion)}];\n`,
);
const folder = appFolder(
  release,
  readdirSync(releaseRoot, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const path = join(entry.parentPath, entry.name);
      return { path: relative(releaseRoot, path), bytes: readFileSync(path) };
    }),
);
renameSync(releaseRoot, join(artifact, 'app', folder));
mkdirSync(join(webRoot, 'api'));
writeFileSync(join(webRoot, 'api/index.php'), apiPointer(folder));
writeFileSync(
  join(artifact, 'release.json'),
  `${JSON.stringify({ appVersion, release: folder, schemaVersion: schemaVersion(migrations) }, null, 2)}\n`,
);
run(process.execPath, ['deploy/cli.ts', 'manifest', '--artifact', artifact], {
  GITHUB_SHA: env.GITHUB_SHA ?? git('rev-parse', 'HEAD'),
  GITHUB_RUN_ID: env.GITHUB_RUN_ID ?? 'local',
  GITHUB_RUN_ATTEMPT: env.GITHUB_RUN_ATTEMPT ?? '1',
  BASE: '/',
});

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
writeFileSync(
  `${archive}.sha256`,
  `${digest}  performance-${release}.tar.gz\n`,
);
console.log(`artifact ${archive}\nsha256 ${digest}`);
