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
  version: string | undefined;
}

export { type Listing, type ListingEntry } from './ports.ts';
