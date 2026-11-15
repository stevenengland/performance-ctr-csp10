import { join, posix } from 'node:path';
import {
  ASSET_DIR,
  parseManifest,
  type Manifest,
} from '../contract/artifact.ts';
import { manifestId, parseVersion, type RemotePaths } from './layout.ts';
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
  root: Listing = new Map();
  deploy: Listing = new Map();
  manifestFiles: Listing = new Map();
  assets: Listing = new Map();
  readonly site = new Map<string, ListingEntry>();
  readonly staged = new Map<string, Map<string, ListingEntry>>();

  constructor(paths: RemotePaths, tmp: string) {
    this.paths = paths;
    this.tmp = tmp;
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
        this.onStagedIds(ids);
      });
    }
  }

  private onManifests(listing: Listing): void {
    this.manifestFiles = listing;
    for (const [name, entry] of listing) {
      if (!entry.dir && manifestId(name) !== undefined) {
        this.get(posix.join(this.paths.manifests, name), `manifest-${name}`);
      }
    }
  }

  private onStagedIds(listing: Listing): void {
    for (const [id, entry] of listing) {
      if (!entry.dir) continue;
      const tree = new Map<string, ListingEntry>();
      this.staged.set(id, tree);
      this.ls(this.paths.stagedDir(id), (dir) => {
        this.onStaged(id, tree, '', dir);
      });
    }
  }

  private onStaged(
    id: string,
    tree: Map<string, ListingEntry>,
    relative: string,
    listing: Listing,
  ): void {
    for (const [name, entry] of listing) {
      const path = posix.join(relative, name);
      tree.set(path, entry);
      if (entry.dir) {
        this.ls(this.paths.stagedFile(id, path), (dir) => {
          this.onStaged(id, tree, path, dir);
        });
      }
    }
  }

  private onSite(relative: string, listing: Listing): void {
    for (const [name, entry] of listing) {
      const path = posix.join(relative, name);
      this.site.set(path, entry);
      if (relative === '' && name === ASSET_DIR && entry.dir) {
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

/** One strict top-down walk of the remote, a wave of `ls`/`get` per transport session. */
export async function observeRemote(
  ports: { transport: FileTransport; files: LocalFiles },
  paths: RemotePaths,
): Promise<RemoteState> {
  const { transport, files } = ports;
  const tmp = await files.mkdtemp();
  try {
    const observation = new Observation(paths, tmp);
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
      version: parseVersion(await fetched(observation.site, 'version.json')),
    };
  } finally {
    await files.remove(tmp);
  }
}
