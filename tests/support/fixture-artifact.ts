import { execFile } from 'node:child_process';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import {
  APP_DIR,
  MANIFEST_FILE,
  parseManifest,
  parseRelease,
  RELEASE_FILE,
  WEB_DIR,
  type Manifest,
} from '../../deploy/contract/artifact.ts';
import { fixtureAppFolder, fixtureSite } from './fixture-site.ts';

const run = promisify(execFile);
const root = join(import.meta.dirname, '..', '..');

/**
The built artifact whose PHP release every fixture reuses, so the proof runs
the real API (Slim, migrator, health) on the PHP image: `node
scripts/build-artifact.ts` writes it, CI downloads the build job's.
*/
const BUILT = process.env.DEPLOY_TEST_ARTIFACT ?? join(root, 'dist/artifact');

async function put(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

/** A guarded migration of the real API's shape; `fails` makes its DDL invalid. */
function proofMigration(fails: boolean): string {
  const ddl = fails
    ? 'CREATE TABLE deploy_proof_marker (id INT, id INT)'
    : 'CREATE TABLE deploy_proof_marker (id INT UNSIGNED NOT NULL PRIMARY KEY)';
  return `<?php

declare(strict_types=1);

use Performance\\Domain\\Migration;

return new class implements Migration {
    public function isApplied(PDO $pdo): bool
    {
        $statement = $pdo->query(
            "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'deploy_proof_marker'",
        );

        return $statement !== false && (int) $statement->fetchColumn() > 0;
    }

    public function apply(PDO $pdo): void
    {
        $pdo->exec('${ddl}');
    }
};
`;
}

export interface FixtureApp {
  /** Adds the guarded migration `0002_deploy_proof_marker`, which raises the schema version to 2. */
  schemaVersion?: 1 | 2;
  /** That migration's DDL fails (the corrected release keeps its name). */
  failing?: boolean;
  /** What the release's health reports, when it differs from release.json. */
  reportedVersion?: string;
}

/** The real PHP release of the built artifact under the commit's folder, with the fixture's version and migrations. */
async function writeApp(
  dir: string,
  commit: string,
  { schemaVersion = 1, failing = false, reportedVersion }: FixtureApp,
): Promise<void> {
  const json = await readFile(join(BUILT, RELEASE_FILE), 'utf8').catch(
    () => undefined,
  );
  if (json === undefined) {
    throw new Error(
      `no built artifact at ${BUILT}: run node scripts/build-artifact.ts first`,
    );
  }
  const built = parseRelease(json);
  const builtMigrations = await readdir(
    join(BUILT, APP_DIR, built.folder, 'migrations'),
  );
  if (built.schemaVersion !== 1 || builtMigrations.length !== 1) {
    throw new Error(
      'the deploy proof expects a built artifact with exactly one migration; adapt its fixture migrations',
    );
  }
  const folder = fixtureAppFolder(commit);
  const appVersion = folder.replace('-', '+');
  const release = join(dir, APP_DIR, folder);
  await cp(join(BUILT, APP_DIR, built.folder), release, { recursive: true });
  await put(
    join(release, 'release.php'),
    `<?php\n\ndeclare(strict_types=1);\n\nreturn ['appVersion' => '${reportedVersion ?? appVersion}'];\n`,
  );
  if (schemaVersion === 2) {
    await put(
      join(release, 'migrations/0002_deploy_proof_marker.php'),
      proofMigration(failing),
    );
  }
  await put(
    join(dir, RELEASE_FILE),
    JSON.stringify({ appVersion, release: folder, schemaVersion }),
  );
}

/** Writes the fixture site to `<dir>/web` and a PHP release to `<dir>/app`, and builds the manifest with the real cli. */
export async function writeFixtureArtifact(
  dir: string,
  commit: string,
  extras?: string[],
  app: FixtureApp = {},
): Promise<Manifest> {
  for (const [path, content] of fixtureSite(commit, extras)) {
    await put(join(dir, WEB_DIR, path), content);
  }
  await writeApp(dir, commit, app);
  await run(
    process.execPath,
    [join(root, 'deploy/cli.ts'), 'manifest', '--artifact', dir],
    {
      cwd: root,
      env: {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? '',
        GITHUB_SHA: commit,
        GITHUB_RUN_ID: '1',
        GITHUB_RUN_ATTEMPT: '1',
        BASE: '/',
      },
    },
  );
  return parseManifest(await readFile(join(dir, MANIFEST_FILE), 'utf8'));
}
