import type { TargetPolicy } from './policy.ts';

export interface Header {
  name: string;
  value: string;
}

/**
Scripts stay strict; styles allow inline because Vuetify writes its theme as a
runtime style element (PRD #1, accepted trade-off of choosing Vuetify).
*/
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');
export const PERMISSIONS_POLICY =
  'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()';
export const REFERRER_POLICY = 'strict-origin-when-cross-origin';
/** Names the server software; removed from every response. */
export const POWERED_BY = 'X-Powered-By';

export function headers(policy: Pick<TargetPolicy, 'origin'>): Header[] {
  const list: Header[] = [
    { name: 'Content-Security-Policy', value: CSP },
    { name: 'X-Content-Type-Options', value: 'nosniff' },
    { name: 'Referrer-Policy', value: REFERRER_POLICY },
    { name: 'Permissions-Policy', value: PERMISSIONS_POLICY },
  ];
  if (policy.origin.startsWith('https://')) {
    list.push({ name: 'Strict-Transport-Security', value: 'max-age=31536000' });
  }
  return list;
}
