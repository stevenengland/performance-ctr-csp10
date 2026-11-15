/*
Serves a folder over HTTP on localhost for the fixture-preview smoke test:
  node e2e/support/serve-static.ts <folder> <port>
Plain static files only, as on an artifact host; no SPA fallback, no API.
*/
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { argv } from 'node:process';

const [folder = '.', port = '4173'] = argv.slice(2);
const root = resolve(folder);
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

createServer((request, response) => {
  const path = decodeURIComponent(
    new URL(request.url ?? '/', 'http://x').pathname,
  );
  const file = join(
    root,
    normalize(path.endsWith('/') ? `${path}index.html` : path),
  );
  if (
    !file.startsWith(root) ||
    !statSync(file, { throwIfNoEntry: false })?.isFile()
  ) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, {
    'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
  });
  createReadStream(file).pipe(response);
}).listen(Number(port), '127.0.0.1');
