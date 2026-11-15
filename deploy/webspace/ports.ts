import type { ManifestEntry } from '../contract/artifact.ts';
import type { Header } from '../contract/headers.ts';

export type FileCommand =
  | { op: 'mkdir'; path: string }
  | { op: 'put'; local: string; remote: string }
  | { op: 'rename'; from: string; to: string }
  | { op: 'rm'; path: string }
  | { op: 'rmdir'; path: string }
  | { op: 'ls'; path: string }
  | { op: 'get'; remote: string; local: string };

export interface ListingEntry {
  size: number;
  dir: boolean;
}
/**
A directory's entries by name, without `.` and `..`. SFTP lists an entry that
is neither file nor folder (a symlink) as a file.
*/
export type Listing = ReadonlyMap<string, ListingEntry>;

/**
One strict transport session per call; throws when any command fails. Resolves
with the listing of every `ls` command, keyed by the path it listed.
*/
export interface FileTransport {
  run(
    step: string,
    commands: readonly FileCommand[],
  ): Promise<ReadonlyMap<string, Listing>>;
}

export interface HttpCheck {
  url: string;
  expectStatus: readonly number[];
  headers?: readonly Header[];
  /** Header names the response must not carry. */
  absentHeaders?: readonly string[];
  body?: string;
}

export interface HttpChecker {
  run(checks: readonly HttpCheck[]): Promise<void>;
}

export interface LocalFiles {
  artifactFiles(webDir: string): Promise<ManifestEntry[]>;
  readFile(path: string): Promise<string | undefined>;
  writeFile(path: string, content: string): Promise<void>;
  mkdtemp(): Promise<string>;
  remove(dir: string): Promise<void>;
}
