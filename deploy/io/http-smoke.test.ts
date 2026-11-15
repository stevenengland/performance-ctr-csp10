import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHttpChecker, httpChecker } from './http-smoke.ts';

let server: Server;
let origin: string;
const report = {
  appVersion: '0.1.0+3736c2a',
  phpVersion: '8.3.36',
  database: { engine: 'MySQL', version: '8.4.13' },
  schemaVersion: 1,
  migration: 'ok',
  minClientVersion: '0.1.0',
};
/** Health answers `running` this many more times before `ok`. */
let running = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/hang') return;
    if (req.url === '/') {
      res.writeHead(200, { 'X-Content-Type-Options': 'nosniff' }).end('ok');
      return;
    }
    if (req.url === '/api/health') {
      const migration = running > 0 ? 'running' : 'ok';
      running -= 1;
      res.writeHead(200).end(JSON.stringify({ ...report, migration }));
      return;
    }
    if (req.url === '/broken/api/health') {
      res.writeHead(200).end(JSON.stringify({ ...report, schemaVersion: 'x' }));
      return;
    }
    if (req.url === '/down/api/health') {
      res.writeHead(500).end('{}');
      return;
    }
    if (req.url === '/version.json') {
      res.writeHead(200).end('{"release":"r1"}');
      return;
    }
    res.writeHead(404).end('missing');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  origin = `http://127.0.0.1:${String(typeof address === 'object' && address ? address.port : 0)}`;
});
afterAll(
  () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => {
        resolve();
      });
    }),
);

describe('httpChecker', () => {
  it('passes when status, headers and body match', async () => {
    await expect(
      httpChecker.run([
        {
          url: `${origin}/`,
          expectStatus: [200],
          headers: [{ name: 'X-Content-Type-Options', value: 'nosniff' }],
          absentHeaders: ['X-Powered-By'],
        },
        {
          url: `${origin}/version.json`,
          expectStatus: [200],
          body: '{"release":"r1"}',
        },
        { url: `${origin}/.htaccess`, expectStatus: [403, 404] },
      ]),
    ).resolves.toBeUndefined();
  });

  it.each([
    [
      'status',
      { url: '/nope/', expectStatus: [200] },
      /expected status 200, got 404/,
    ],
    [
      'header',
      {
        url: '/',
        expectStatus: [200],
        headers: [{ name: 'X-Content-Type-Options', value: 'none' }],
      },
      /header X-Content-Type-Options is "nosniff", expected "none"/,
    ],
    [
      'missing header',
      {
        url: '/version.json',
        expectStatus: [200],
        headers: [{ name: 'X-Robots-Tag', value: 'none' }],
      },
      /missing header X-Robots-Tag/,
    ],
    [
      'present header',
      {
        url: '/',
        expectStatus: [200],
        absentHeaders: ['X-Content-Type-Options'],
      },
      /unexpected header X-Content-Type-Options/,
    ],
    [
      'body',
      { url: '/version.json', expectStatus: [200], body: '{"release":"r2"}' },
      /unexpected body/,
    ],
  ] as const)(
    'fails on a %s mismatch and names the url',
    async (_what, check, message) => {
      const run = httpChecker.run([{ ...check, url: `${origin}${check.url}` }]);
      await expect(run).rejects.toThrow(message);
      await expect(run).rejects.toThrow(`${origin}${check.url}`);
    },
  );

  it('gives up on a stalled response and names the url', async () => {
    const run = createHttpChecker({ timeoutMs: 50 }).run([
      { url: `${origin}/hang`, expectStatus: [200] },
    ]);
    await expect(run).rejects.toThrow(
      `http check failed: ${origin}/hang timed out after 50 ms`,
    );
  });
});

describe('httpChecker.health', () => {
  const fast = createHttpChecker({ runningAttempts: 3, runningDelayMs: 1 });

  it('returns the report health answers', async () => {
    running = 0;
    await expect(fast.health(`${origin}/api/health`)).resolves.toEqual(report);
  });

  it('asks again while a migration is running', async () => {
    running = 2;
    await expect(fast.health(`${origin}/api/health`)).resolves.toMatchObject({
      migration: 'ok',
    });
  });

  it('gives up waiting and returns the running report', async () => {
    running = 5;
    await expect(fast.health(`${origin}/api/health`)).resolves.toMatchObject({
      migration: 'running',
    });
  });

  it('fails naming the url when health does not answer 200', async () => {
    await expect(fast.health(`${origin}/down/api/health`)).rejects.toThrow(
      `health check failed: ${origin}/down/api/health answered 500`,
    );
  });

  it('fails naming the field health answered without', async () => {
    await expect(fast.health(`${origin}/broken/api/health`)).rejects.toThrow(
      `health check failed: ${origin}/broken/api/health health response is malformed: schemaVersion`,
    );
  });
});
