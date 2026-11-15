import { execFile } from 'node:child_process';

export interface SpawnResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type Spawn = (
  command: string,
  args: readonly string[],
  options: { env: Readonly<Record<string, string>>; input?: string },
) => Promise<SpawnResult>;

const COMMAND_NOT_FOUND = 127;
/** Backstop only: ssh's ConnectTimeout and ServerAlive* end a stalled session long before this. */
const TIMEOUT_MS = 30 * 60 * 1000;

export const spawnProcess: Spawn = (command, args, options) =>
  new Promise((resolve) => {
    const child = execFile(
      command,
      args,
      { env: options.env, maxBuffer: 16 * 1024 * 1024, timeout: TIMEOUT_MS },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ code: 0, stdout, stderr });
          return;
        }
        const code =
          typeof error.code === 'number' ? error.code : COMMAND_NOT_FOUND;
        resolve({
          code,
          stdout,
          stderr: stderr === '' ? error.message : stderr,
        });
      },
    );
    child.stdin?.on('error', () => {
      // EPIPE when the child exits before reading; its exit code reports why.
    });
    child.stdin?.end(options.input ?? '');
  });
