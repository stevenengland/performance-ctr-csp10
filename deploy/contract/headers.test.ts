import { describe, expect, it } from 'vitest';
import {
  CSP,
  PERMISSIONS_POLICY,
  REFERRER_POLICY,
  headers,
} from './headers.ts';

describe('headers', () => {
  it('emits the full set with HSTS for an https target', () => {
    expect(headers({ origin: 'https://www.example.test' })).toEqual([
      { name: 'Content-Security-Policy', value: CSP },
      { name: 'X-Content-Type-Options', value: 'nosniff' },
      { name: 'Referrer-Policy', value: REFERRER_POLICY },
      { name: 'Permissions-Policy', value: PERMISSIONS_POLICY },
      { name: 'Strict-Transport-Security', value: 'max-age=31536000' },
    ]);
  });

  it('omits HSTS for an http target', () => {
    expect(
      headers({ origin: 'http://localhost:8080' }).map((header) => header.name),
    ).toEqual([
      'Content-Security-Policy',
      'X-Content-Type-Options',
      'Referrer-Policy',
      'Permissions-Policy',
    ]);
  });

  it('keeps scripts strict and allows inline styles only', () => {
    expect(CSP).toContain("script-src 'self'");
    expect(CSP).not.toMatch(/script-src[^;]*unsafe/);
    expect(CSP).toContain("style-src 'self' 'unsafe-inline'");
  });
});
