import { join } from 'node:path';
import {
  buildManifest,
  MANIFEST_FILE,
  parseManifest,
  WEB_DIR,
  type Manifest,
} from './contract/artifact.ts';
import { requiredVariable } from './contract/parse.ts';
import {
  parseAssetDir,
  parsePolicy,
  parseWebspaceSettings,
  targetPolicy,
  type Env,
} from './contract/policy.ts';
import { localFiles } from './io/fs.ts';
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
  manifest --artifact <dir>                      Write <dir>/manifest.json for the web root in <dir>/web
  deploy --artifact <dir>                        Deploy the artifact to the production webspace
  rollback --artifact <dir> --release <id>       Activate a retained release again from its artifact
  inspect                                        Print the active and retained releases as JSON
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
  const manifest = buildManifest({
    commit: requiredEnv(env, 'GITHUB_SHA'),
    runId: requiredEnv(env, 'GITHUB_RUN_ID'),
    runAttempt: requiredEnv(env, 'GITHUB_RUN_ATTEMPT'),
    buildTime: new Date(),
    base: requiredEnv(env, 'BASE'),
    files: await localFiles.artifactFiles(join(artifact, WEB_DIR)),
  });
  const path = join(artifact, MANIFEST_FILE);
  await localFiles.writeFile(
    path,
    `${JSON.stringify(manifest, undefined, 2)}\n`,
  );
  print(
    'manifest',
    `${manifest.releaseId} (${String(manifest.files.length)} files) → ${path}`,
  );
}

async function readArtifactManifest(artifact: string): Promise<Manifest> {
  return parseManifest(
    await localFiles.readFile(join(artifact, MANIFEST_FILE)),
  );
}

/** Parses the policy, settings and SFTP login, registers the login as secrets and wires the adapter. */
function adapterFor(env: Env) {
  const policy = parsePolicy(env);
  const settings = parseWebspaceSettings(env);
  const endpoint = parseSftpEndpoint(env);
  secrets.push(endpoint.password, endpoint.user);
  const adapter = createAdapter({
    transport: createSftpTransport(endpoint, { spawn: spawnProcess }),
    http: httpChecker,
    files: localFiles,
    settings,
    now: () => new Date(),
    log: out,
  });
  return { adapter, policy };
}

async function release(
  args: Extract<Command, { command: 'deploy' | 'rollback' }>,
  env: Env,
): Promise<void> {
  const { adapter, policy } = adapterFor(env);
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

async function main(argv: readonly string[], env: Env): Promise<number> {
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
