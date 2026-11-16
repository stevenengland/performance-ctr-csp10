// The finish phase: staged leftovers, .part files and the pruned releases, assets, manifests
// and PHP release folders (via the trash). The target root also holds files the deploy does
// not own; finish never touches it.

import { posix } from 'node:path';
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
  removeTree,
  rmdir,
  rename,
  mkdir,
  hasDir,
  partFiles,
} from './phase.ts';

export interface PrunePlan {
  releases: Release[];
  removeAssets: string[];
  removeManifests: string[];
  /** PHP release folders below `app/` that no kept release names. */
  removeApps: string[];
}

export function prunePlan(
  state: State,
  manifests: ReadonlyMap<string, Manifest>,
  assets: Listing,
  now: Date,
  assetDir: string,
  apps: Iterable<string> = [],
): PrunePlan {
  const { kept: releases, dropped } = pruneLedger(state, now);
  const keptManifests = releases.map((release) =>
    releaseManifest(manifests, release.id),
  );
  const referenced = new Set(
    keptManifests.flatMap((manifest) =>
      hashedAssets(manifest, assetDir).map((file) =>
        assetName(assetDir, file.path),
      ),
    ),
  );
  const folders = new Set(keptManifests.map((manifest) => manifest.app.folder));
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
    removeApps: [...apps]
      .filter((folder) => !folders.has(folder))
      .toSorted(compare),
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
    remote.apps
      .entries()
      .filter(([, entry]) => entry.dir)
      .map(([folder]) => folder),
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
    ...trashApps(input, prune.removeApps),
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

/**
Moves pruned PHP release folders into `.deploy/trash/` with one rename each:
removing a folder over SFTP takes its whole tree, which only the trash walk
lists. A folder already in the trash waits for the trash to empty.
*/
function trashApps(
  input: PlanInput,
  folders: readonly string[],
): FileCommand[] {
  const { remote, paths } = input;
  const moved = folders.filter((folder) => !remote.trash.has(folder));
  if (moved.length === 0) return [];
  return [
    ...(hasDir(remote.deploy, posix.basename(paths.trash))
      ? []
      : [mkdir(paths.trash)]),
    ...moved.map((folder) =>
      rename(paths.appDir(folder), posix.join(paths.trash, folder)),
    ),
  ];
}

/** Empties `.deploy/trash/`, file by file and folder by folder, on every run that finds something there. */
export const trashPhase: Rule = (input) => {
  const { trash } = input.remote;
  if (trash.size === 0) return;
  const folder = (name: string) => posix.join(input.paths.trash, name);
  return transferPhase(
    'trash',
    [...trash].flatMap(([name, tree]) => [
      ...removeTree(tree, (path) => posix.join(folder(name), path)),
      rmdir(folder(name)),
    ]),
  );
};

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
