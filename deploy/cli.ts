import { join } from 'node:path';
import {
  APP_DIR,
  buildManifest,
  MANIFEST_FILE,
  parseManifest,
  parseRelease,
  RELEASE_FILE,
  releaseTag,
  WEB_DIR,
  type Manifest,
} from './contract/artifact.ts';
import { healthUrl } from './contract/health.ts';
import { orderRelease, parseInspection } from './contract/ordering.ts';
import { requiredVariable } from './contract/parse.ts';
import {
  parseAssetDir,
  parsePolicy,
  parseWebspaceSettings,
  targetPolicy,
  type Env,
} from './contract/policy.ts';
import {
  parseRuntimeConfig,
  RUNTIME_SECRETS,
} from './contract/runtime-config.ts';
import { localFiles } from './io/fs.ts';
import { ancestry } from './io/git.ts';
import { httpChecker } from './io/http-smoke.ts';
import { spawnProcess } from './io/process.ts';
import { redact } from './io/redact.ts';
import { createSftpTransport, parseSftpEndpoint } from './io/sftp.ts';
import { renderHtaccess } from './webspace/htaccess.ts';
import { createAdapter } from './webspace/adapter.ts';
import { parseCommand, type Command } from './cli-args.ts';

const USAGE = `Usage: node deploy/cli.ts <command>

Commands:
  render-htaccess <site-url>                     Print the web root's .htaccess for the site URL (and ASSET_DIR)
  manifest --artifact <dir>                      Write <dir>/manifest.json for <dir>/web and the PHP release <dir>/release.json names
  deploy --artifact <dir>                        Deploy the artifact to the production webspace
  rollback --artifact <dir> --release <id>       Activate a retained release with the live schema version again from its artifact
  inspect                                        Print the active and retained releases as JSON
  order --artifact <dir> --inspection <file>     Print skip=true|false: does the artifact move production forward?
  live-check                                     Check that production health answers with every field and migration ok
  release-tag                                    Print the GitHub Release tag for a deploy now (release-YYYYMMDD-HHMM)
`;

const EXIT_FAILURE = 1;
const EXIT_USAGE = 2;

/** Every line the cli prints passes through here, so no parsed secret reaches the logs. */
const secrets: string[] = [];
function print(prefix: string, message: string): void {
  process.stdout.write(`${prefix}: ${redact(message, secrets)}\n`);
}
function out(line: string): void {
  print('deploy', line);
}
/** GitHub's escaping for command data, so a message can never end the `::error::` line early. */
const escapeCommandData = (text: string): string =>
  text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
function fail(message: string): void {
  process.stderr.write(
    `::error::deploy: ${escapeCommandData(redact(message, secrets))}\n`,
  );
}

function requiredEnv(env: Env, name: string): string {
  return requiredVariable(env, name, 'environment');
}

/** Kept as slice #4 shipped it: plain stderr, because e2e/stack/stage.sh pipes stdout into a file. */
function renderCommand(siteUrl: string, env: Env): number {
  let assetDir: string;
  try {
    assetDir = parseAssetDir(env);
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    return EXIT_FAILURE;
  }
  try {
    process.stdout.write(renderHtaccess(targetPolicy(siteUrl, assetDir)));
    return 0;
  } catch (error) {
    process.stderr.write(`Invalid site URL: ${(error as Error).message}\n`);
    return EXIT_FAILURE;
  }
}

async function writeManifest(artifact: string, env: Env): Promise<void> {
  const release = parseRelease(
    await localFiles.readFile(join(artifact, RELEASE_FILE)),
  );
  const manifest = buildManifest({
    commit: requiredEnv(env, 'GITHUB_SHA'),
    runId: requiredEnv(env, 'GITHUB_RUN_ID'),
    runAttempt: requiredEnv(env, 'GITHUB_RUN_ATTEMPT'),
    buildTime: new Date(),
    base: requiredEnv(env, 'BASE'),
    files: await localFiles.artifactFiles(join(artifact, WEB_DIR)),
    app: {
      ...release,
      files: await localFiles.artifactFiles(
        join(artifact, APP_DIR, release.folder),
      ),
    },
  });
  const path = join(artifact, MANIFEST_FILE);
  await localFiles.writeFile(
    path,
    `${JSON.stringify(manifest, undefined, 2)}\n`,
  );
  print(
    'manifest',
    `${manifest.releaseId} (${String(manifest.files.length)} web files, ${String(manifest.app.files.length)} in app/${manifest.app.folder}, schema version ${String(manifest.app.schemaVersion)}) → ${path}`,
  );
}

async function readArtifactManifest(artifact: string): Promise<Manifest> {
  return parseManifest(
    await localFiles.readFile(join(artifact, MANIFEST_FILE)),
  );
}

/** Every secret the cli may see; their values are masked in each line it prints, whether or not the command uses them. */
const SECRET_NAMES = ['SFTP_USER', 'SFTP_PASS', ...RUNTIME_SECRETS];

/**
Parses the policy, settings and SFTP login and wires the adapter; deploy and
rollback also parse the runtime configuration, inspect does not need it.
*/
function adapterFor(env: Env, { withRuntimeConfig = false } = {}) {
  const policy = parsePolicy(env);
  const settings = parseWebspaceSettings(env);
  const endpoint = parseSftpEndpoint(env);
  const adapter = createAdapter({
    transport: createSftpTransport(endpoint, { spawn: spawnProcess }),
    http: httpChecker,
    files: localFiles,
    settings,
    ...(withRuntimeConfig && { runtimeConfig: parseRuntimeConfig(env) }),
    now: () => new Date(),
    log: out,
  });
  return { adapter, policy };
}

async function release(
  args: Extract<Command, { command: 'deploy' | 'rollback' }>,
  env: Env,
): Promise<void> {
  const { adapter, policy } = adapterFor(env, { withRuntimeConfig: true });
  const artifact = {
    dir: args.artifact,
    manifest: await readArtifactManifest(args.artifact),
  };
  const outcome =
    args.command === 'deploy'
      ? await adapter.deploy(artifact, policy)
      : await adapter.rollback(artifact, args.release, policy);
  print(
    args.command,
    `release ${outcome.releaseId} (${outcome.commit}) active`,
  );
}

/** Prints the inspection alone on stdout: release ids and commits, nothing else from the host. */
async function inspect(env: Env): Promise<void> {
  const { adapter, policy } = adapterFor(env);
  process.stdout.write(`${JSON.stringify(await adapter.inspect(policy))}\n`);
}

/** Prints `skip=true|false` alone on stdout, for `$GITHUB_OUTPUT`; a skip is also a notice. */
async function order(
  args: Extract<Command, { command: 'order' }>,
): Promise<void> {
  const { commit: candidate } = await readArtifactManifest(args.artifact);
  const json = await localFiles.readFile(args.inspection);
  if (json === undefined) throw new Error(`${args.inspection} is missing`);
  const { active } = parseInspection(json, args.inspection);
  const decision = orderRelease({
    candidate,
    active: active?.commit ?? '',
    ancestry:
      active === undefined
        ? { kind: 'none' }
        : await ancestry(spawnProcess, '.', active.commit, candidate),
  });
  if (decision.action === 'fail') throw new Error(decision.message);
  if (decision.action === 'skip') {
    process.stderr.write(`::notice::deploy: ${decision.message}\n`);
  }
  process.stdout.write(`skip=${String(decision.action === 'skip')}\n`);
}

/** The weekly check: production health answers 200 with every field and its schema migrated. */
async function liveCheck(env: Env): Promise<void> {
  const url = healthUrl(parsePolicy(env));
  const report = await httpChecker.health(url);
  if (report.migration !== 'ok') {
    throw new Error(
      `live check failed: ${url} reports migration ${report.migration}`,
    );
  }
  print(
    'live-check',
    `${url}: app ${report.appVersion}, PHP ${report.phpVersion}, ${report.database.engine} ${report.database.version}, schema version ${String(report.schemaVersion)}, migration ${report.migration}`,
  );
}

async function main(argv: readonly string[], env: Env): Promise<number> {
  for (const name of SECRET_NAMES) {
    const value = env[name];
    if (value !== undefined && value !== '') secrets.push(value);
  }
  const command = parseCommand(argv);
  if (command === undefined) {
    process.stderr.write(USAGE);
    return EXIT_USAGE;
  }
  if (command.command === 'render-htaccess') {
    return renderCommand(command.siteUrl, env);
  }
  try {
    switch (command.command) {
      case 'manifest': {
        await writeManifest(command.artifact, env);
        break;
      }
      case 'inspect': {
        await inspect(env);
        break;
      }
      case 'order': {
        await order(command);
        break;
      }
      case 'live-check': {
        await liveCheck(env);
        break;
      }
      case 'release-tag': {
        process.stdout.write(`${releaseTag(new Date())}\n`);
        break;
      }
      default: {
        await release(command, env);
      }
    }
    return 0;
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    return EXIT_FAILURE;
  }
}

process.exitCode = await main(process.argv.slice(2), process.env);
