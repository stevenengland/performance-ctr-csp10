import {
  API_ENTRY,
  ASSET_DIR,
  REVALIDATED_FILES,
} from '../contract/artifact.ts';
import { headers, POWERED_BY } from '../contract/headers.ts';
import type { TargetPolicy } from '../contract/policy.ts';

// Apache's server variables; Apache expands them, not JS.
const REQUEST_URI = '%{REQUEST_URI}';
const HTTP_HOST = '%{HTTP_HOST}';
const REQUEST_FILENAME = '%{REQUEST_FILENAME}';

const PREAMBLE = [
  '# Rendered by deploy/webspace/htaccess.ts from the current target policy. Do not edit on the server.',
  'Options -Indexes',
  'DirectoryIndex index.html',
];

// PHP runs through the host's handler for api/index.php; no app server for the web root.
const APP_SERVER_OFF = [
  '<IfModule mod_passenger.c>',
  '  PassengerEnabled off',
  '</IfModule>',
];

// A front proxy that serves static files itself (X-Accel-Redirect) sends only
// a few of Apache's headers; without this request header Apache serves them.
const STATIC_FILES_IN_APACHE = ['RequestHeader unset X-Accel-Internal'];

function escapeRegex(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

function httpsRedirect(policy: TargetPolicy): string[] {
  if (!policy.origin.startsWith('https://')) return [];
  const { host } = new URL(policy.origin);
  return [
    `  RewriteCond ${HTTP_HOST} !=${host} [OR]`,
    '  RewriteCond %{HTTPS} !=on',
    `  RewriteRule ^ https://${host}${REQUEST_URI} [R=301,L]`,
  ];
}

// END stops the rewritten request from passing through these rules again.
function routing(policy: TargetPolicy): string[] {
  return [
    '<IfModule mod_rewrite.c>',
    '  RewriteEngine On',
    `  RewriteBase ${policy.base}`,
    ...httpsRedirect(policy),
    `  RewriteRule ^api/ ${API_ENTRY} [END]`,
    // App routes have no file extension; a missing asset stays a 404 so a stale chunk fails loudly.
    `  RewriteCond ${REQUEST_FILENAME} !-f`,
    `  RewriteCond ${REQUEST_FILENAME} !-d`,
    '  RewriteRule ^[^.]*$ index.html [END]',
    '</IfModule>',
  ];
}

function securityHeaders(policy: TargetPolicy): string[] {
  return [
    ...headers(policy).map(
      (header) => `Header always set ${header.name} "${header.value}"`,
    ),
    // Both tables: modules add the header to either the error or the success one.
    `Header always unset ${POWERED_BY}`,
    `Header unset ${POWERED_BY}`,
  ];
}

function caching(policy: TargetPolicy): string[] {
  const names = REVALIDATED_FILES.map(escapeRegex).join('|');
  return [
    `<FilesMatch "^(${names})$">`,
    `  Header always set Cache-Control "${policy.caching.revalidate}"`,
    '</FilesMatch>',
    `<If "${REQUEST_URI} =~ m#^${policy.base}${ASSET_DIR}/#">`,
    `  Header always set Cache-Control "${policy.caching.assets}"`,
    '</If>',
  ];
}

export function renderHtaccess(policy: TargetPolicy): string {
  const blocks = [
    PREAMBLE,
    APP_SERVER_OFF,
    STATIC_FILES_IN_APACHE,
    routing(policy),
    securityHeaders(policy),
    caching(policy),
  ];
  return `${blocks.map((block) => block.join('\n')).join('\n\n')}\n`;
}
