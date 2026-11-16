// The cli's argv as a typed command; pure, so cli.ts keeps the I/O.

import { parseArgs } from 'node:util';

export type Command =
  | { command: 'render-htaccess'; siteUrl: string }
  | { command: 'manifest'; artifact: string }
  | { command: 'deploy'; artifact: string }
  | { command: 'rollback'; artifact: string; release: string }
  | { command: 'inspect' }
  | { command: 'order'; artifact: string; inspection: string }
  | { command: 'live-check' }
  | { command: 'release-tag' };

const OPTIONS = {
  artifact: { type: 'string' },
  release: { type: 'string' },
  inspection: { type: 'string' },
} as const;

type Values = Partial<Record<keyof typeof OPTIONS, string>>;

function toCommand(
  [command, ...rest]: readonly string[],
  { artifact, release, inspection }: Values,
): Command | undefined {
  const [siteUrl] = rest;
  if (command === 'render-htaccess') {
    return rest.length === 1 && siteUrl !== undefined
      ? { command, siteUrl }
      : undefined;
  }
  if (rest.length > 0) return undefined;
  // Every option given must belong to the command.
  const given = [artifact, release, inspection].filter(
    (value) => value !== undefined,
  ).length;
  switch (command) {
    case 'manifest':
    case 'deploy': {
      return artifact !== undefined && given === 1
        ? { command, artifact }
        : undefined;
    }
    case 'rollback': {
      return artifact !== undefined && release !== undefined && given === 2
        ? { command, artifact, release }
        : undefined;
    }
    case 'order': {
      return artifact !== undefined && inspection !== undefined && given === 2
        ? { command, artifact, inspection }
        : undefined;
    }
    case 'inspect':
    case 'live-check':
    case 'release-tag': {
      return given === 0 ? { command } : undefined;
    }
    default: {
      return undefined;
    }
  }
}

/** The command `argv` names, or `undefined` when it is malformed. */
export function parseCommand(argv: readonly string[]): Command | undefined {
  try {
    const { values, positionals } = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: OPTIONS,
    });
    return toCommand(positionals, values);
  } catch {
    return undefined;
  }
}
