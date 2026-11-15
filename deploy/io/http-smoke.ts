import type { HttpCheck, HttpChecker } from '../webspace/ports.ts';

function failure(
  check: HttpCheck,
  response: Response,
  body: string,
): string | undefined {
  if (!check.expectStatus.includes(response.status)) {
    return `expected status ${check.expectStatus.join(' or ')}, got ${String(response.status)}`;
  }
  const headers = check.headers ?? [];
  for (const header of headers) {
    const actual = response.headers.get(header.name);
    if (actual === null) return `missing header ${header.name}`;
    if (actual !== header.value) {
      return `header ${header.name} is "${actual}", expected "${header.value}"`;
    }
  }
  const present = check.absentHeaders?.find((name) =>
    response.headers.has(name),
  );
  if (present !== undefined) return `unexpected header ${present}`;
  return check.body !== undefined && body !== check.body
    ? 'unexpected body'
    : undefined;
}

const TIMEOUT_MS = 30_000;

async function fetchCheck(check: HttpCheck, timeoutMs: number) {
  try {
    const response = await fetch(check.url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { response, body: await response.text() };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new Error(
        `http check failed: ${check.url} timed out after ${String(timeoutMs)} ms`,
        { cause: error },
      );
    }
    throw error;
  }
}

export function createHttpChecker({
  timeoutMs = TIMEOUT_MS,
}: { timeoutMs?: number } = {}): HttpChecker {
  return {
    async run(checks) {
      for (const check of checks) {
        const { response, body } = await fetchCheck(check, timeoutMs);
        const problem = failure(check, response, body);
        if (problem !== undefined) {
          throw new Error(`http check failed: ${check.url} ${problem}`);
        }
      }
    },
  };
}

export const httpChecker = createHttpChecker();
