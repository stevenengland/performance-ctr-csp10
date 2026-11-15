import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHttpChecker, httpChecker } from './http-smoke.ts';

let server: Server;
let origin: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/hang') return;
    if (req.url === '/') {
      res.writeHead(200, { 'X-Content-Type-Options': 'nosniff' }).end('ok');
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
