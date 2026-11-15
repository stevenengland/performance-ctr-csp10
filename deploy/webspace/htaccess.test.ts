import { describe, expect, it } from 'vitest';
import { CSP } from '../contract/headers.ts';
import { targetPolicy } from '../contract/policy.ts';
import { renderHtaccess } from './htaccess.ts';

const https = targetPolicy('https://performance.example.test');
const http = targetPolicy('http://localhost:8080');

describe('renderHtaccess', () => {
  it.each([
    ['https', https],
    ['http', http],
  ])('renders the %s target', async (name, policy) => {
    await expect(renderHtaccess(policy)).toMatchFileSnapshot(
      `./fixtures/${name}.htaccess`,
    );
  });

  it('redirects another host or plain http to the https origin and sends HSTS only for an https origin', () => {
    expect(renderHtaccess(http)).not.toMatch(/R=301|Strict-Transport-Security/);
    const text = renderHtaccess(https);
    expect(text).toContain(
      [
        '  RewriteCond %{HTTP_HOST} !=performance.example.test [OR]',
        '  RewriteCond %{HTTPS} !=on',
        '  RewriteRule ^ https://performance.example.test%{REQUEST_URI} [R=301,L]',
      ].join('\n'),
    );
    expect(text).toContain('Strict-Transport-Security "max-age=31536000"');
  });

  it('sends every request below api/ to the PHP entry pointer', () => {
    expect(renderHtaccess(http)).toContain(
      '  RewriteRule ^api/ api/index.php [END]',
    );
  });

  it('serves the app shell for extension-less app routes that are not files, and never for assets', () => {
    const text = renderHtaccess(http);
    expect(text).toContain(
      [
        '  RewriteCond %{REQUEST_FILENAME} !-f',
        '  RewriteCond %{REQUEST_FILENAME} !-d',
        '  RewriteRule ^[^.]*$ index.html [END]',
      ].join('\n'),
    );
    expect(text.indexOf('^api/')).toBeLessThan(text.indexOf('^[^.]*$'));
  });

  it('revalidates the app shell, service worker and manifest, and caches hashed assets forever', () => {
    const text = renderHtaccess(http);
    expect(text).toContain(
      String.raw`<FilesMatch "^(index\.html|sw\.js|manifest\.webmanifest)$">` +
        '\n  Header always set Cache-Control "no-cache"\n</FilesMatch>',
    );
    expect(text).toContain(
      '<If "%{REQUEST_URI} =~ m#^/assets/#">\n  Header always set Cache-Control "public, max-age=31536000, immutable"\n</If>',
    );
  });

  it('sends the CSP with strict scripts and inline styles for the runtime theme on every response', () => {
    expect(CSP).toContain("script-src 'self'");
    expect(CSP).toContain("style-src 'self' 'unsafe-inline'");
    expect(CSP).toContain("frame-ancestors 'none'");
    expect(CSP).not.toContain("'unsafe-eval'");
    expect(renderHtaccess(http)).toContain(
      `Header always set Content-Security-Policy "${CSP}"`,
    );
  });

  it('removes the server software header from both header tables', () => {
    const text = renderHtaccess(https);
    expect(text).toContain('Header always unset X-Powered-By\n');
    expect(text).toContain('Header unset X-Powered-By\n');
  });

  it('is base-aware', () => {
    const text = renderHtaccess(targetPolicy('https://example.test/sub'));
    expect(text).toContain('  RewriteBase /sub/');
    expect(text).toContain('<If "%{REQUEST_URI} =~ m#^/sub/assets/#">');
  });
});

describe('targetPolicy', () => {
  it.each(['ftp://example.test', 'https://example.test/?q=1', 'not a url'])(
    'rejects %s',
    (value) => {
      expect(() => targetPolicy(value)).toThrow(/http:\/\/ or https:\/\//);
    },
  );
});
