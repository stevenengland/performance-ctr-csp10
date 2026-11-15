import { posix } from 'node:path';
import { ASSET_DIR, hashedAssets, pages } from '../contract/artifact.ts';
import { httpChecks } from './checks.ts';
import { renderHtaccess } from './htaccess.ts';
import { assetName, partName, VERIFIED_MARKER, versionJson } from './layout.ts';
import {
  activateRelease,
  activeRelease,
  inProgressRelease,
  startRelease,
} from './ledger.ts';
import type { Tree } from './remote-state.ts';
import {
  type Phase,
  type PlanInput,
  type Rule,
  transferPhase,
  tempPath,
  webPath,
  hasDir,
  missingDirs,
  mkdir,
  put,
  rename,
  putThenRename,
  type Upload,
  uploadThenRename,
  removeStagedRelease,
} from './phase.ts';
import { cleanupPhase } from './cleanup.ts';
import { finishPhase } from './prune.ts';

function accessUploads(input: PlanInput): Upload[] {
  const { policy, paths, remote } = input;
  return [
    {
      file: { name: '.htaccess', content: renderHtaccess(policy) },
      target: paths.siteFile('.htaccess'),
      listing: remote.site,
    },
  ];
}

const accessPhase: Rule = (input) =>
  uploadThenRename(
    input,
    'access',
    ['access-upload', 'access-commit'],
    accessUploads(input),
    hasDir(input.remote.root, posix.basename(input.paths.site))
      ? []
      : [mkdir(input.paths.site)],
  );

/** Active in the ledger and served: a newly named served folder has to be published again. */
function isAlreadyActive(input: PlanInput): boolean {
  const { state, version } = input.remote;
  const id = input.manifest.releaseId;
  return (
    inProgressRelease(state) === undefined &&
    activeRelease(state)?.id === id &&
    version === id
  );
}

const markerPhase: Rule = (input) => {
  const { remote, manifest, paths } = input;
  if (inProgressRelease(remote.state)?.id === manifest.releaseId) {
    return;
  }
  const state = startRelease(
    remote.state,
    { id: manifest.releaseId, commit: manifest.commit },
    input.now,
  );
  // A staged tree (and its .verified) from an earlier attempt of this release
  // must not vouch for the new attempt.
  const stale = remote.staged.get(manifest.releaseId);
  const staleStaging =
    stale === undefined
      ? []
      : removeStagedRelease(input, manifest.releaseId, stale);
  const mkdirs = [
    ...(hasDir(remote.root, '.deploy') ? [] : [paths.deploy]),
    ...(hasDir(remote.deploy, 'manifests') ? [] : [paths.manifests]),
    ...(hasDir(remote.deploy, 'staged') ? [] : [paths.staged]),
    ...(hasDir(remote.site, ASSET_DIR) ? [] : [paths.siteFile(ASSET_DIR)]),
  ].map((path) => mkdir(path));
  return transferPhase(
    'marker',
    [
      ...staleStaging,
      ...mkdirs,
      ...putThenRename(
        tempPath(input, 'manifest.json'),
        paths.manifest(manifest.releaseId),
      ),
      ...putThenRename(tempPath(input, 'state.json'), paths.state),
    ],
    [
      { name: 'manifest.json', content: JSON.stringify(manifest) },
      { name: 'state.json', content: JSON.stringify(state) },
    ],
  );
};

const assetsPhase: Rule = (input) => {
  const { assets } = input.remote;
  const hashed = hashedAssets(input.manifest);
  const verified = hashed.filter(
    (file) => assets.get(partName(assetName(file.path)))?.size === file.size,
  );
  if (verified.length > 0) {
    return transferPhase(
      'assets-commit',
      verified.map((file) => {
        const target = input.paths.siteFile(file.path);
        return rename(partName(target), target);
      }),
    );
  }
  const needed = hashed.filter(
    (file) => assets.get(assetName(file.path))?.size !== file.size,
  );
  return needed.length === 0
    ? undefined
    : transferPhase(
        'assets-upload',
        needed.map((file) =>
          put(
            webPath(input, file.path),
            partName(input.paths.siteFile(file.path)),
          ),
        ),
      );
};

function stagedTree(input: PlanInput): Tree {
  return input.remote.staged.get(input.manifest.releaseId) ?? new Map();
}

const stagingPhase: Rule = (input) => {
  const tree = stagedTree(input);
  if (tree.has(VERIFIED_MARKER)) return;
  const id = input.manifest.releaseId;
  const { paths } = input;
  const needed = pages(input.manifest).filter(
    (file) => tree.get(file.path)?.size !== file.size,
  );
  if (needed.length === 0) {
    return transferPhase(
      'staging-verified',
      [
        put(
          tempPath(input, VERIFIED_MARKER),
          paths.stagedFile(id, VERIFIED_MARKER),
        ),
      ],
      [{ name: VERIFIED_MARKER, content: '' }],
    );
  }
  const stagedDir = input.remote.staged.has(id)
    ? []
    : [mkdir(paths.stagedDir(id))];
  const dirs = missingDirs(
    needed.map((file) => file.path),
    (dir) => tree.get(dir)?.dir === true,
  ).map((dir) => mkdir(paths.stagedFile(id, dir)));
  const puts = needed.map((file) =>
    put(webPath(input, file.path), paths.stagedFile(id, file.path)),
  );
  return transferPhase('staging-upload', [...stagedDir, ...dirs, ...puts]);
};

const activationPhase: Rule = (input) => {
  const tree = stagedTree(input);
  const id = input.manifest.releaseId;
  const { paths } = input;
  const remaining = pages(input.manifest).filter(
    (file) => tree.get(file.path)?.dir === false,
  );
  if (remaining.length === 0) return;
  const dirs = missingDirs(
    remaining.map((file) => file.path),
    (dir) => input.remote.site.get(dir)?.dir === true,
  ).map((dir) => mkdir(paths.siteFile(dir)));
  const renames = remaining.map((file) =>
    rename(paths.stagedFile(id, file.path), paths.siteFile(file.path)),
  );
  return transferPhase('activation', [...dirs, ...renames]);
};

const versionPhase: Rule = (input) => {
  const { manifest, paths, remote } = input;
  if (remote.version === manifest.releaseId) return;
  return uploadThenRename(
    input,
    'version',
    ['version-upload', 'version-commit'],
    [
      {
        file: { name: 'version.json', content: versionJson(manifest) },
        target: paths.siteFile('version.json'),
        listing: remote.site,
      },
    ],
  );
};

const httpPhase: Rule = (input) => {
  if (input.completed.has('http-checks')) return;
  return {
    kind: 'http',
    name: 'http-checks',
    checks: httpChecks(input.manifest, input.policy, input.aliases),
  };
};

const recordPhase: Rule = (input) => {
  const { remote, manifest } = input;
  if (inProgressRelease(remote.state)?.id !== manifest.releaseId) {
    return;
  }
  const state = activateRelease(remote.state, manifest.releaseId, input.now);
  return transferPhase(
    'record',
    putThenRename(tempPath(input, 'state.json'), input.paths.state),
    [{ name: 'state.json', content: JSON.stringify(state) }],
  );
};

const RELEASE_RULES: readonly Rule[] = [
  markerPhase,
  assetsPhase,
  stagingPhase,
  activationPhase,
];

const TAIL_RULES: readonly Rule[] = [
  versionPhase,
  cleanupPhase,
  httpPhase,
  recordPhase,
  finishPhase,
];

export function planNext(input: PlanInput): Phase {
  const rules = isAlreadyActive(input)
    ? [accessPhase, ...TAIL_RULES]
    : [accessPhase, ...RELEASE_RULES, ...TAIL_RULES];
  for (const rule of rules) {
    const phase = rule(input);
    if (phase !== undefined) return phase;
  }
  return { kind: 'done' };
}
