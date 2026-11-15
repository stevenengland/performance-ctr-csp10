// The cleanup phase: what the deploy put into the served folder and the release no longer ships.

import {
  activatedFiles,
  comparePaths as compare,
  type Manifest,
} from '../contract/artifact.ts';
import { parentDirs, partName } from './layout.ts';
import {
  deepestFirst,
  rm,
  rmdir,
  transferPhase,
  type PlanInput,
  type Rule,
} from './phase.ts';
import type { Tree } from './remote-state.ts';

const OVERLAY_FILES = ['.htaccess', 'version.json'];

interface Pages {
  files: Set<string>;
  dirs: Set<string>;
}

// Hashed assets are not activated files: the shared asset directory belongs to prune.
function pagesOf(manifests: readonly Manifest[], assetDir: string): Pages {
  const paths = manifests.flatMap((manifest) =>
    activatedFiles(manifest, assetDir).map((file) => file.path),
  );
  return {
    files: new Set(paths),
    dirs: new Set(paths.flatMap((path) => parentDirs(path))),
  };
}

/** The deploy's own entries the release no longer ships; a recorded release's pages and the overlay are the deploy's. */
function removable(input: PlanInput): { files: string[]; dirs: string[] } {
  const { assetDir } = input.policy;
  const owned = pagesOf(
    [...input.remote.manifests.values(), input.manifest],
    assetDir,
  );
  const kept = pagesOf([input.manifest], assetDir);
  for (const file of OVERLAY_FILES) {
    owned.files.add(file).add(partName(file));
    kept.files.add(file);
  }
  const entries = [...input.remote.site];
  const pick = (kind: keyof Pages) =>
    entries
      .filter(
        ([path, entry]) =>
          entry.dir === (kind === 'dirs') &&
          owned[kind].has(path) &&
          !kept[kind].has(path),
      )
      .map(([path]) => path);
  return { files: pick('files').toSorted(compare), dirs: pick('dirs') };
}

/** The candidate folders left empty once `removed` is gone; anything else inside keeps a folder. */
function emptiedDirs(
  site: Tree,
  candidates: readonly string[],
  removed: Set<string>,
): string[] {
  const emptied: string[] = [];
  for (const dir of deepestFirst(candidates)) {
    const inside = site.keys().filter((path) => path.startsWith(`${dir}/`));
    if (!inside.every((path) => removed.has(path))) continue;
    removed.add(dir);
    emptied.push(dir);
  }
  return emptied;
}

export const cleanupPhase: Rule = (input) => {
  if (input.completed.has('cleanup')) return;
  const { files, dirs } = removable(input);
  const emptied = emptiedDirs(input.remote.site, dirs, new Set(files));
  if (files.length === 0 && emptied.length === 0) return;
  const { paths } = input;
  return transferPhase('cleanup', [
    ...files.map((path) => rm(paths.siteFile(path))),
    ...emptied.map((dir) => rmdir(paths.siteFile(dir))),
  ]);
};
