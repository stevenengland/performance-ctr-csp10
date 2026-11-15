// The finish phase: staged leftovers, .part files and the pruned releases, assets and manifests.
// The target root also holds files the deploy does not own; finish never touches it.

import {
  comparePaths as compare,
  hashedAssets,
  type Manifest,
} from '../contract/artifact.ts';
import { assetName, assetPath, isPartName } from './layout.ts';
import type { FileCommand } from './ports.ts';
import { pruneLedger, type Release, type State } from './ledger.ts';
import { releaseManifest, type Listing } from './remote-state.ts';
import {
  type TempFile,
  type PlanInput,
  type Rule,
  transferPhase,
  tempPath,
  rm,
  putThenRename,
  removeStagedRelease,
  partFiles,
} from './phase.ts';

export interface PrunePlan {
  releases: Release[];
  removeAssets: string[];
  removeManifests: string[];
}

export function prunePlan(
  state: State,
  manifests: ReadonlyMap<string, Manifest>,
  assets: Listing,
  now: Date,
  assetDir: string,
): PrunePlan {
  const { kept: releases, dropped } = pruneLedger(state, now);
  const referenced = new Set(
    releases.flatMap((release) =>
      hashedAssets(releaseManifest(manifests, release.id), assetDir).map(
        (file) => assetName(assetDir, file.path),
      ),
    ),
  );
  const unreferenced = [...assets]
    .filter(
      ([name, entry]) =>
        !entry.dir && !isPartName(name) && !referenced.has(name),
    )
    .map(([name]) => name)
    .toSorted(compare);
  return {
    releases,
    removeAssets: unreferenced,
    removeManifests: dropped.map((release) => release.id),
  };
}

function stagingLeftovers(input: PlanInput): FileCommand[] {
  return [...input.remote.staged].flatMap(([id, tree]) =>
    removeStagedRelease(input, id, tree),
  );
}

function pruneCommands(input: PlanInput): {
  commands: FileCommand[];
  files: TempFile[];
} {
  const { remote, paths, now } = input;
  const { assetDir } = input.policy;
  const prune = prunePlan(
    remote.state,
    remote.manifests,
    remote.assets,
    now,
    assetDir,
  );
  const ledger = new Set(remote.state.releases.map((release) => release.id));
  const orphans = remote.manifests
    .keys()
    .filter((id) => !ledger.has(id))
    .toArray();
  const commands = [
    ...prune.removeAssets.map((name) =>
      rm(paths.siteFile(assetPath(assetDir, name))),
    ),
    ...[
      ...prune.removeManifests.filter((id) => remote.manifests.has(id)),
      ...orphans,
    ].map((id) => rm(paths.manifest(id))),
  ];
  if (prune.releases.length === remote.state.releases.length) {
    return { commands, files: [] };
  }
  return {
    commands: [
      ...commands,
      ...putThenRename(tempPath(input, 'state.json'), paths.state),
    ],
    files: [
      {
        name: 'state.json',
        content: JSON.stringify({ releases: prune.releases }),
      },
    ],
  };
}

export const finishPhase: Rule = (input) => {
  if (input.completed.has('finish')) return;
  const { remote, paths } = input;
  const prune = pruneCommands(input);
  const commands = [
    ...stagingLeftovers(input),
    ...partFiles(remote.assets).map((name) =>
      rm(paths.siteFile(assetPath(input.policy.assetDir, name))),
    ),
    ...prune.commands,
  ];
  return commands.length === 0
    ? undefined
    : transferPhase('finish', commands, prune.files);
};
