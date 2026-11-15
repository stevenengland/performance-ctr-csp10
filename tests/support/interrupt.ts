import type {
  Listing,
  FileCommand,
  FileTransport,
} from '../../deploy/webspace/ports.ts';

/** Where a simulated disconnect strikes; unset fields match every step or op. */
export interface Interrupt {
  step?: string;
  op?: FileCommand['op'];
  /** Matching commands that still go through before the connection drops; `all` drops it after the first matching batch. */
  count: number | 'all';
}

/**
Passes commands to `inner` until `count` matching commands went through,
then drops the connection: the rest of that batch never runs and the call
throws. Steps other than `at.step` pass untouched.
*/
export function interrupt(
  inner: FileTransport,
  at: Interrupt,
): FileTransport & { fired: boolean } {
  let seen = 0;
  const transport = {
    fired: false,
    async run(
      step: string,
      commands: readonly FileCommand[],
    ): Promise<ReadonlyMap<string, Listing>> {
      if (transport.fired || (at.step !== undefined && step !== at.step)) {
        return inner.run(step, commands);
      }
      const limit = at.count === 'all' ? Infinity : at.count;
      const prefix: FileCommand[] = [];
      for (const command of commands) {
        if (seen >= limit) break;
        prefix.push(command);
        if (at.op === undefined || command.op === at.op) seen += 1;
      }
      if (at.count !== 'all' && seen < limit) {
        return inner.run(step, commands);
      }
      if (prefix.length > 0) await inner.run(step, prefix);
      transport.fired = true;
      throw new Error(
        `simulated disconnect during ${step} after ${String(prefix.length)} commands`,
      );
    },
  };
  return transport;
}
