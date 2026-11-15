import { join } from 'node:path';
import {
  checkCompatibility,
  isSameManifest,
  verifyManifest,
  WEB_DIR,
  type Manifest,
} from '../contract/artifact.ts';
import type {
  Artifact,
  DeployOperations,
  Inspection,
  Outcome,
} from '../contract/operations.ts';
import type { TargetPolicy, WebspaceSettings } from '../contract/policy.ts';
import { remotePaths, type RemotePaths } from './layout.ts';
import { activeRelease, retainedReleases, summarize } from './ledger.ts';
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
  verifyManifest(
    manifest,
    await session.files.artifactFiles(join(artifact.dir, WEB_DIR)),
  );
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
): Promise<Outcome> {
  const { files, paths, now, log } = session;
  await prepare(session, artifact, manifest, policy);
  const tempDir = await files.mkdtemp();
  const completed = new Set<PhaseName>();
  try {
    for (let iteration = 0; iteration < MAX_PHASES; iteration += 1) {
      const remote = await observeRemote(session, paths, policy.assetDir);
      if (iteration === 0) log(describeRemote(remote));
      const phase = planNext({
        remote,
        manifest,
        policy,
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
  return converge(session, artifact, retainedManifest, policy);
}

async function inspectRemote(
  session: Session,
  policy: TargetPolicy,
): Promise<Inspection> {
  const remote = await observeRemote(session, session.paths, policy.assetDir);
  const active = activeRelease(remote.state);
  return {
    ...(active !== undefined && {
      active: { releaseId: active.id, commit: active.commit },
    }),
    retained: retainedReleases(remote.state).map((release) => release.id),
  };
}

export function createAdapter(ports: AdapterPorts): DeployOperations {
  const { remoteRoot, docroot } = ports.settings;
  const session = { ...ports, paths: remotePaths(remoteRoot, docroot) };
  return {
    deploy: (artifact, policy) =>
      converge(session, artifact, artifact.manifest, policy),
    rollback: (artifact, releaseId, policy) =>
      rollbackTo(session, artifact, releaseId, policy),
    inspect: (policy) => inspectRemote(session, policy),
  };
}
