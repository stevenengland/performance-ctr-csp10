import { join, posix } from 'node:path';
import { parseManifest, type Manifest } from '../contract/artifact.ts';
import {
  manifestId,
  parseVersion,
  VERIFIED_MARKER,
  type RemotePaths,
} from './layout.ts';
import { parseState } from './ledger.ts';
import type { LocalFiles, FileCommand, FileTransport } from './ports.ts';
import type { Listing, ListingEntry, RemoteState } from './remote-state.ts';

type Request =
  | { op: 'ls'; path: string; onListing: (listing: Listing) => void }
  | { op: 'get'; remote: string; local: string };

/** Collects what one strict top-down walk of the remote showed. */
class Observation {
  private pending: Request[] = [];
  private readonly paths: RemotePaths;
  private readonly tmp: string;
  private readonly assetDir: string;
  private readonly appFolder: string | undefined;
  root: Listing = new Map();
  deploy: Listing = new Map();
  manifestFiles: Listing = new Map();
  assets: Listing = new Map();
  readonly site = new Map<string, ListingEntry>();
  readonly staged = new Map<string, Map<string, ListingEntry>>();
  apps: Listing = new Map();
  readonly release = new Map<string, ListingEntry>();
  readonly trash = new Map<string, Map<string, ListingEntry>>();
  config: Listing = new Map();

  constructor(
    paths: RemotePaths,
    tmp: string,
    assetDir: string,
    appFolder: string | undefined,
  ) {
    this.paths = paths;
    this.tmp = tmp;
    this.assetDir = assetDir;
    this.appFolder = appFolder;
    this.ls(paths.root, (listing) => {
      this.onRoot(listing);
    });
  }

  private ls(path: string, onListing: (listing: Listing) => void): void {
    this.pending.push({ op: 'ls', path, onListing });
  }

  private get(remote: string, name: string): void {
    this.pending.push({ op: 'get', remote, local: this.local(name) });
  }

  private onRoot(listing: Listing): void {
    this.root = listing;
    if (listing.get('.deploy')?.dir) {
      this.ls(this.paths.deploy, (deploy) => {
        this.onDeploy(deploy);
      });
    }
    if (listing.get(posix.basename(this.paths.site))?.dir) {
      this.ls(this.paths.site, (site) => {
        this.onSite('', site);
      });
    }
    if (listing.get(posix.basename(this.paths.app))?.dir) {
      this.ls(this.paths.app, (folders) => {
        this.onApps(folders);
      });
    }
    if (listing.get(posix.basename(this.paths.config))?.dir) {
      this.ls(this.paths.config, (config) => {
        this.config = config;
      });
    }
  }

  private onDeploy(listing: Listing): void {
    this.deploy = listing;
    if (listing.get('state.json')?.dir === false) {
      this.get(this.paths.state, 'state.json');
    }
    if (listing.get('manifests')?.dir) {
      this.ls(this.paths.manifests, (files) => {
        this.onManifests(files);
      });
    }
    if (listing.get('staged')?.dir) {
      this.ls(this.paths.staged, (ids) => {
        this.onTrees(ids, this.staged, (id, path) =>
          this.paths.stagedFile(id, path),
        );
      });
    }
    if (listing.get('trash')?.dir) {
      this.ls(this.paths.trash, (folders) => {
        this.onTrees(folders, this.trash, (folder, path) =>
          posix.join(this.paths.trash, folder, path),
        );
      });
    }
  }

  /** Lists the release folders; walks the one being deployed until it holds `.verified`. */
  private onApps(listing: Listing): void {
    this.apps = listing;
    const folder = this.appFolder;
    if (folder === undefined || listing.get(folder)?.dir !== true) return;
    this.ls(this.paths.appDir(folder), (top) => {
      if (top.get(VERIFIED_MARKER)?.dir === false) {
        for (const [name, entry] of top) this.release.set(name, entry);
        return;
      }
      this.onTree(this.release, '', top, (path) =>
        this.paths.appFile(folder, path),
      );
    });
  }

  private onManifests(listing: Listing): void {
    this.manifestFiles = listing;
    for (const [name, entry] of listing) {
      if (!entry.dir && manifestId(name) !== undefined) {
        this.get(posix.join(this.paths.manifests, name), `manifest-${name}`);
      }
    }
  }

  /** Walks every folder of `listing` into `trees`; `file` maps a folder and a path inside it to the remote path. */
  private onTrees(
    listing: Listing,
    trees: Map<string, Map<string, ListingEntry>>,
    file: (folder: string, path: string) => string,
  ): void {
    for (const [folder, entry] of listing) {
      if (!entry.dir) continue;
      const tree = new Map<string, ListingEntry>();
      trees.set(folder, tree);
      this.ls(file(folder, ''), (dir) => {
        this.onTree(tree, '', dir, (path) => file(folder, path));
      });
    }
  }

  private onTree(
    tree: Map<string, ListingEntry>,
    relative: string,
    listing: Listing,
    file: (path: string) => string,
  ): void {
    for (const [name, entry] of listing) {
      const path = posix.join(relative, name);
      tree.set(path, entry);
      if (entry.dir) {
        this.ls(file(path), (dir) => {
          this.onTree(tree, path, dir, file);
        });
      }
    }
  }

  private onSite(relative: string, listing: Listing): void {
    for (const [name, entry] of listing) {
      const path = posix.join(relative, name);
      this.site.set(path, entry);
      if (relative === '' && name === this.assetDir && entry.dir) {
        this.ls(this.paths.siteFile(path), (assets) => {
          this.assets = assets;
        });
      } else if (entry.dir) {
        this.ls(this.paths.siteFile(path), (dir) => {
          this.onSite(path, dir);
        });
      } else if (path === 'version.json') {
        this.get(this.paths.siteFile(path), path);
      }
    }
  }

  /** Takes the requests of the next wave; empty once the walk is complete. */
  takeWave(): Request[] {
    const wave = this.pending;
    this.pending = [];
    return wave;
  }

  local(name: string): string {
    return join(this.tmp, name);
  }
}

function toCommand(request: Request): FileCommand {
  return request.op === 'ls'
    ? { op: 'ls', path: request.path }
    : { op: 'get', remote: request.remote, local: request.local };
}

async function readManifests(
  files: LocalFiles,
  paths: RemotePaths,
  observation: Observation,
): Promise<Map<string, Manifest>> {
  const manifests = new Map<string, Manifest>();
  for (const [name, entry] of observation.manifestFiles) {
    const id = manifestId(name);
    if (id === undefined || entry.dir) continue;
    const remotePath = paths.manifest(id);
    const json = await files.readFile(observation.local(`manifest-${name}`));
    try {
      manifests.set(id, parseManifest(json));
    } catch (error) {
      throw new Error(
        `remote is inconsistent: ${remotePath}: ${(error as Error).message}`,
        { cause: error },
      );
    }
  }
  return manifests;
}

/**
One strict top-down walk of the remote, a wave of `ls`/`get` per transport
session. `appFolder` names the PHP release folder whose files the deploy
needs to see.
*/
export async function observeRemote(
  ports: { transport: FileTransport; files: LocalFiles },
  paths: RemotePaths,
  assetDir: string,
  appFolder?: string,
): Promise<RemoteState> {
  const { transport, files } = ports;
  const tmp = await files.mkdtemp();
  try {
    const observation = new Observation(paths, tmp, assetDir, appFolder);
    for (let wave = 1; ; wave += 1) {
      const requests = observation.takeWave();
      if (requests.length === 0) break;
      const listings = await transport.run(
        `observe-${String(wave)}`,
        requests.map((request) => toCommand(request)),
      );
      for (const request of requests) {
        if (request.op === 'ls') {
          request.onListing(listings.get(request.path) ?? new Map());
        }
      }
    }
    const fetched = (listing: Listing, name: string) =>
      listing.get(name)?.dir === false
        ? files.readFile(observation.local(name))
        : Promise.resolve(undefined);
    return {
      state: parseState(await fetched(observation.deploy, 'state.json')),
      manifests: await readManifests(files, paths, observation),
      root: observation.root,
      deploy: observation.deploy,
      site: observation.site,
      assets: observation.assets,
      staged: observation.staged,
      apps: observation.apps,
      release: observation.release,
      trash: observation.trash,
      config: observation.config,
      version: parseVersion(await fetched(observation.site, 'version.json')),
    };
  } finally {
    await files.remove(tmp);
  }
}
