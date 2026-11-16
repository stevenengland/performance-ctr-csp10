import { join } from 'node:path';
import {
  APP_DIR,
  checkCompatibility,
  isSameManifest,
  verifyManifest,
  WEB_DIR,
  type Manifest,
} from '../contract/artifact.ts';
import { healthProblem, healthUrl } from '../contract/health.ts';
import { schemaFloorProblem } from '../contract/schema-floor.ts';
import type {
  Artifact,
  DeployOperations,
  Inspection,
  Outcome,
} from '../contract/operations.ts';
import type { TargetPolicy, WebspaceSettings } from '../contract/policy.ts';
import type { RuntimeConfig } from '../contract/runtime-config.ts';
import { remotePaths, type RemotePaths } from './layout.ts';
import {
  activeRelease,
  inProgressRelease,
  retainedReleases,
  summarize,
} from './ledger.ts';
import { observeRemote } from './observe.ts';
import type { Phase, PhaseName } from './phase.ts';
import { planNext } from './plan.ts';
import type { HttpChecker, LocalFiles, FileTransport } from './ports.ts';
import { releaseManifest, type RemoteState } from './remote-state.ts';

export interface AdapterPorts {
  transport: FileTransport;
  http: HttpChecker;
  files: LocalFiles;
  settings: WebspaceSettings;
  /** What the API reads at runtime; deploy and rollback render it, inspect needs none. */
  runtimeConfig?: RuntimeConfig;
  now: () => Date;
  log: (line: string) => void;
}

const MAX_PHASES = 100;

function list(ids: string[]): string {
  return ids.length > 0 ? ids.join(', ') : 'none';
}

function describeRemote(remote: RemoteState): string {
  const summary = summarize(remote.state);
  return `remote: active ${summary.active ?? 'none'}; retained ${list(summary.retained)}; abandoned ${list(summary.abandoned)}; in progress ${summary.inProgress ?? 'none'}`;
}

/** The ports and the remote layout they act on. */
interface Session extends AdapterPorts {
  paths: RemotePaths;
}

/** Checks the artifact against the policy and its own manifest before any remote contact. */
async function prepare(
  session: Session,
  artifact: Artifact,
  manifest: Manifest,
  policy: TargetPolicy,
): Promise<void> {
  if (policy.base !== '/') {
    // ponytail: base is always / on the target host; map base into the site/ path if sub-path hosting is ever needed
    throw new Error(
      `webspace adapter supports base "/" only, got "${policy.base}"`,
    );
  }
  checkCompatibility(manifest, policy);
  verifyManifest(manifest, {
    web: await session.files.artifactFiles(join(artifact.dir, WEB_DIR)),
    app: await session.files.artifactFiles(
      join(artifact.dir, APP_DIR, manifest.app.folder),
    ),
  });
}

async function execute(
  { transport, http, files }: Session,
  tempDir: string,
  phase: Exclude<Phase, { kind: 'done' }>,
): Promise<void> {
  if (phase.kind === 'http') {
    await http.run(phase.checks);
    return;
  }
  if (phase.kind === 'health') {
    const problem = healthProblem(await http.health(phase.url), phase.expected);
    if (problem !== undefined) {
      throw new Error(`health check failed: ${phase.url} reports ${problem}`);
    }
    return;
  }
  for (const file of phase.files) {
    await files.writeFile(join(tempDir, file.name), file.content);
  }
  await transport.run(phase.name, phase.commands);
}

/** Observes, plans and executes one phase at a time until the plan is done. */
async function converge(
  session: Session,
  artifact: Artifact,
  manifest: Manifest,
  policy: TargetPolicy,
  /** Runs after the artifact checks and before the first remote write. */
  guard: () => Promise<void> = () => Promise.resolve(),
): Promise<Outcome> {
  const { files, paths, now, log, runtimeConfig } = session;
  if (runtimeConfig === undefined) {
    throw new Error('a deploy needs the runtime configuration');
  }
  await prepare(session, artifact, manifest, policy);
  await guard();
  const tempDir = await files.mkdtemp();
  const completed = new Set<PhaseName>();
  try {
    for (let iteration = 0; iteration < MAX_PHASES; iteration += 1) {
      const remote = await observeRemote(
        session,
        paths,
        policy.assetDir,
        manifest.app.folder,
      );
      if (iteration === 0) log(describeRemote(remote));
      const phase = planNext({
        remote,
        manifest,
        policy,
        runtimeConfig,
        aliases: session.settings.aliases,
        paths,
        artifactDir: artifact.dir,
        tempDir,
        now: now(),
        completed,
      });
      if (phase.kind === 'done') {
        return { releaseId: manifest.releaseId, commit: manifest.commit };
      }
      log(`step ${phase.name}`);
      await execute(session, tempDir, phase);
      completed.add(phase.name);
    }
    throw new Error(
      `deploy did not converge after ${String(MAX_PHASES)} phases`,
    );
  } finally {
    await files.remove(tempDir);
  }
}

async function rollbackTo(
  session: Session,
  artifact: Artifact,
  releaseId: string,
  policy: TargetPolicy,
): Promise<Outcome> {
  const remote = await observeRemote(session, session.paths, policy.assetDir);
  const retained = retainedReleases(remote.state).map((release) => release.id);
  if (!retained.includes(releaseId)) {
    throw new Error(
      `release ${releaseId} is not retained; retained releases: ${retained.join(', ')}`,
    );
  }
  const retainedManifest = releaseManifest(remote.manifests, releaseId);
  checkCompatibility(retainedManifest, policy);
  if (!isSameManifest(retainedManifest, artifact.manifest)) {
    throw new Error(`artifact does not match retained release ${releaseId}`);
  }
  await checkLiveSchema(session, retainedManifest, policy);
  return converge(session, artifact, retainedManifest, policy);
}

/**
Rollback never crosses a schema change (fix forward instead): the live API
must report the schema version the retained release expects.
*/
async function checkLiveSchema(
  { http }: Session,
  manifest: Manifest,
  policy: TargetPolicy,
): Promise<void> {
  const expected = manifest.app.schemaVersion;
  const live = (await http.health(healthUrl(policy))).schemaVersion;
  if (live !== expected) {
    throw new Error(
      `release ${manifest.releaseId} expects schema version ${String(expected)}, but the live database is at schema version ${String(live)}; rollback only returns to a release with the live schema, fix forward instead`,
    );
  }
}

/**
A plain deploy never switches the API below the live schema (see
`schemaFloorProblem`): live health reports the database's real schema, and the
ledger's active and in-progress releases cover a health that does not answer.
Runs before the first write, so a refused deploy changes nothing.
*/
async function checkSchemaFloor(
  session: Session,
  manifest: Manifest,
  policy: TargetPolicy,
): Promise<void> {
  const remote = await observeRemote(session, session.paths, policy.assetDir);
  const live = await session.http.health(healthUrl(policy)).then(
    (report) => report.schemaVersion,
    () => {
      session.log(
        'live health did not answer; the schema floor comes from the ledger',
      );
      return undefined;
    },
  );
  const recorded = [
    { release: activeRelease(remote.state), inProgress: false },
    { release: inProgressRelease(remote.state), inProgress: true },
  ].flatMap(({ release, inProgress }) =>
    release === undefined
      ? []
      : [
          {
            releaseId: release.id,
            schemaVersion: releaseManifest(remote.manifests, release.id).app
              .schemaVersion,
            inProgress,
          },
        ],
  );
  const problem = schemaFloorProblem({
    candidate: {
      releaseId: manifest.releaseId,
      schemaVersion: manifest.app.schemaVersion,
    },
    live,
    recorded,
  });
  if (problem !== undefined) throw new Error(problem);
}

async function inspectRemote(
  session: Session,
  policy: TargetPolicy,
): Promise<Inspection> {
  const remote = await observeRemote(session, session.paths, policy.assetDir);
  const active = activeRelease(remote.state);
  const inProgress = inProgressRelease(remote.state);
  return {
    ...(active !== undefined && {
      active: { releaseId: active.id, commit: active.commit },
    }),
    ...(inProgress !== undefined && {
      inProgress: { releaseId: inProgress.id, commit: inProgress.commit },
    }),
    retained: retainedReleases(remote.state).map((release) => release.id),
  };
}

export function createAdapter(ports: AdapterPorts): DeployOperations {
  const { remoteRoot, docroot } = ports.settings;
  const session = { ...ports, paths: remotePaths(remoteRoot, docroot) };
  return {
    deploy: (artifact, policy) =>
      converge(session, artifact, artifact.manifest, policy, () =>
        checkSchemaFloor(session, artifact.manifest, policy),
      ),
    rollback: (artifact, releaseId, policy) =>
      rollbackTo(session, artifact, releaseId, policy),
    inspect: (policy) => inspectRemote(session, policy),
  };
}
