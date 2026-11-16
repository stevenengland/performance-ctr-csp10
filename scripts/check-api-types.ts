/*
Fails when web/src/core/api-client/schema.d.ts is not what `npm run api:types`
generates from api/openapi.yaml, so the committed types never drift from the contract.
*/
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exit, stderr } from 'node:process';

const committed = 'web/src/core/api-client/schema.d.ts';
const scratch = mkdtempSync(join(tmpdir(), 'api-types-'));
const generated = join(scratch, 'schema.d.ts');
try {
  execFileSync(
    'npx',
    ['openapi-typescript', 'api/openapi.yaml', '-o', generated],
    {
      stdio: ['ignore', 'ignore', 'inherit'],
    },
  );
  // Formatted as if it lived at the committed path, with the repository's Prettier config.
  const formatted = execFileSync(
    'npx',
    ['prettier', '--stdin-filepath', committed],
    {
      input: readFileSync(generated, 'utf8'),
      encoding: 'utf8',
    },
  );
  if (formatted !== readFileSync(committed, 'utf8')) {
    stderr.write(
      `${committed} is out of date with api/openapi.yaml: run npm run api:types\n`,
    );
    exit(1);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
