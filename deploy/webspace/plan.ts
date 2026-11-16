import { posix } from 'node:path';
import {
  activatedFiles,
  hashedAssets,
  isShellFile,
} from '../contract/artifact.ts';
import { healthUrl } from '../contract/health.ts';
import { httpChecks } from './checks.ts';
import { renderHtaccess } from './htaccess.ts';
import {
  assetName,
  partName,
  RUNTIME_CONFIG,
  VERIFIED_MARKER,
  versionJson,
} from './layout.ts';
import { renderRuntimeConfig } from './runtime-config.ts';
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
  appPath,
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
import { finishPhase, trashPhase } from './prune.ts';

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
  const { assetDir } = input.policy;
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
    ...(hasDir(remote.site, assetDir) ? [] : [paths.siteFile(assetDir)]),
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
  const { assetDir } = input.policy;
  const name = (file: { path: string }) => assetName(assetDir, file.path);
  const hashed = hashedAssets(input.manifest, assetDir);
  const verified = hashed.filter(
    (file) => assets.get(partName(name(file)))?.size === file.size,
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
    (file) => assets.get(name(file))?.size !== file.size,
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

/**
The PHP release folder below `app/`: every file of the manifest at its size,
then `.verified`, before the API pointer names it. Later observations stop
at a verified folder's top level.
*/
const appPhase: Rule = (input) => {
  const { remote, paths } = input;
  const { folder, files } = input.manifest.app;
  const tree = remote.release;
  if (tree.get(VERIFIED_MARKER)?.dir === false) return;
  const needed = files.filter((file) => {
    const entry = tree.get(file.path);
    return entry?.dir !== false || entry.size !== file.size;
  });
  if (needed.length === 0) {
    return transferPhase(
      'app-verified',
      [
        put(
          tempPath(input, VERIFIED_MARKER),
          paths.appFile(folder, VERIFIED_MARKER),
        ),
      ],
      [{ name: VERIFIED_MARKER, content: '' }],
    );
  }
  const roots = [
    ...(hasDir(remote.root, posix.basename(paths.app)) ? [] : [paths.app]),
    ...(hasDir(remote.apps, folder) ? [] : [paths.appDir(folder)]),
  ];
  const dirs = missingDirs(
    needed.map((file) => file.path),
    (dir) => tree.get(dir)?.dir === true,
  ).map((dir) => paths.appFile(folder, dir));
  return transferPhase('app-upload', [
    ...[...roots, ...dirs].map((dir) => mkdir(dir)),
    ...needed.map((file) =>
      put(appPath(input, file.path), paths.appFile(folder, file.path)),
    ),
  ]);
};

/** The runtime configuration, rendered from the secrets on every deploy and committed by rename. */
const configPhase: Rule = (input) => {
  const { remote, paths } = input;
  return uploadThenRename(
    input,
    'config',
    ['config-upload', 'config-commit'],
    [
      {
        file: {
          name: RUNTIME_CONFIG,
          content: renderRuntimeConfig(input.runtimeConfig),
        },
        target: paths.runtimeConfig,
        listing: remote.config,
      },
    ],
    hasDir(remote.root, posix.basename(paths.config))
      ? []
      : [mkdir(paths.config)],
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
  const needed = activatedFiles(input.manifest, input.policy.assetDir).filter(
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

/** Renames the staged files `select` picks into the served folder. */
function activate(
  input: PlanInput,
  name: 'activation' | 'shell',
  select: (path: string) => boolean,
): Phase | undefined {
  const tree = stagedTree(input);
  const id = input.manifest.releaseId;
  const { paths } = input;
  const remaining = activatedFiles(
    input.manifest,
    input.policy.assetDir,
  ).filter((file) => select(file.path) && tree.get(file.path)?.dir === false);
  if (remaining.length === 0) return;
  const dirs = missingDirs(
    remaining.map((file) => file.path),
    (dir) => input.remote.site.get(dir)?.dir === true,
  ).map((dir) => mkdir(paths.siteFile(dir)));
  const renames = remaining.map((file) =>
    rename(paths.stagedFile(id, file.path), paths.siteFile(file.path)),
  );
  return transferPhase(name, [...dirs, ...renames]);
}

/** Everything but the shell, so the API entry pointer switches to the new PHP release while browsers keep the old shell. */
const activationPhase: Rule = (input) =>
  activate(input, 'activation', (path) => !isShellFile(path));

/**
The first request to the new release: it runs pending migrations and has to
report the release's app version, its schema version and migration `ok`.
*/
const healthPhase: Rule = (input) => {
  if (input.completed.has('health-check')) return;
  const { app } = input.manifest;
  return {
    kind: 'health',
    name: 'health-check',
    url: healthUrl(input.policy),
    expected: { appVersion: app.appVersion, schemaVersion: app.schemaVersion },
  };
};

/** `index.html`, the web manifest and the service worker: last, once the API answers for the release. */
const shellPhase: Rule = (input) => activate(input, 'shell', isShellFile);

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
  appPhase,
  stagingPhase,
  configPhase,
  activationPhase,
  healthPhase,
  shellPhase,
];

/** A re-deploy of the live release still renders the config and asks health before the tail. */
const ACTIVE_RULES: readonly Rule[] = [configPhase, healthPhase];

const TAIL_RULES: readonly Rule[] = [
  versionPhase,
  cleanupPhase,
  httpPhase,
  recordPhase,
  finishPhase,
  trashPhase,
];

export function planNext(input: PlanInput): Phase {
  const rules = isAlreadyActive(input)
    ? [accessPhase, ...ACTIVE_RULES, ...TAIL_RULES]
    : [accessPhase, ...RELEASE_RULES, ...TAIL_RULES];
  for (const rule of rules) {
    const phase = rule(input);
    if (phase !== undefined) return phase;
  }
  return { kind: 'done' };
}
