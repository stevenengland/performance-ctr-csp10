import { execFile, type ExecFileOptions } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export interface Captured {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs a process to completion and returns its exit code and output instead of rejecting. */
export async function runCaptured(
  file: string,
  args: string[],
  options: ExecFileOptions,
): Promise<Captured> {
  try {
    const { stdout, stderr } = await run(file, args, {
      ...options,
      encoding: 'utf8',
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };
    return {
      code: failed.code ?? 1,
      stdout: failed.stdout ?? '',
      stderr: failed.stderr ?? '',
    };
  }
}
