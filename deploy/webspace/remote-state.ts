import type { Manifest } from '../contract/artifact.ts';
import type { State } from './ledger.ts';
import type { Listing, ListingEntry } from './ports.ts';

/** A release's manifest; the ledger naming a release without one is an inconsistent remote. */
export function releaseManifest(
  manifests: ReadonlyMap<string, Manifest>,
  id: string,
): Manifest {
  const manifest = manifests.get(id);
  if (manifest === undefined) {
    throw new Error(`remote is inconsistent: release ${id} has no manifest`);
  }
  return manifest;
}

export type Tree = ReadonlyMap<string, ListingEntry>;

export interface RemoteState {
  state: State;
  manifests: ReadonlyMap<string, Manifest>;
  root: Listing;
  deploy: Listing;
  site: Tree;
  assets: Listing;
  staged: ReadonlyMap<string, Tree>;
  /** The PHP release folders below `app/`. */
  apps: Listing;
  /**
  The tree of the PHP release folder being deployed: its top level alone once
  it holds `.verified`, every file before that.
  */
  release: Tree;
  /** PHP release folders moved to `.deploy/trash/` by prune, with their whole trees. */
  trash: ReadonlyMap<string, Tree>;
  config: Listing;
  version: string | undefined;
}

export { type Listing, type ListingEntry } from './ports.ts';
