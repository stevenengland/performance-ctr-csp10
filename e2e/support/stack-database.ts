import { execFileSync } from 'node:child_process';

/**
The client that runs SQL from stdin on the stack's database. CI starts the stack with
Docker Compose (e2e/stack/compose.yml), whose `db` service is reachable only through
`docker compose exec`; a stack on another database names its client in
`E2E_STACK_SQL`, e.g. `mariadb -h127.0.0.1 -uperformance -pperformance performance`.
*/
const client =
  process.env.E2E_STACK_SQL ??
  'docker compose -f e2e/stack/compose.yml exec -T db mariadb -uperformance -pperformance performance';

/** The rows whose recording instant decides their period (PRD #70). */
export type RecordedRows = 'entries' | 'matches' | 'results';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A `DATETIME(3)` literal of an instant in UTC, as the API stores it. */
function utc(instant: Date): string {
  return `'${instant.toISOString().replace('T', ' ').replace('Z', '')}'`;
}

/**
Moves a row back to an earlier recording instant (`created_at`), and its confirmation
to `verifiedAt` when given, as if it had been recorded then: the API records every
row at its own clock, so a test cannot record on another day. The change counts as a
write (the data revision moves on), so conditional reads see it like any other.
*/
export function recordedAt(
  rows: RecordedRows,
  id: string,
  instant: Date,
  verifiedAt?: Date,
): void {
  if (!UUID.test(id)) throw new Error(`not a row id: ${id}`);
  const verified =
    verifiedAt === undefined ? '' : `, verified_at = ${utc(verifiedAt)}`;
  const sql = `UPDATE ${rows} SET created_at = ${utc(instant)}${verified} WHERE id = '${id}';
SELECT ROW_COUNT() AS moved;
INSERT INTO data_revision (id, revision) VALUES (1, 1) ON DUPLICATE KEY UPDATE revision = revision + 1;`;
  const output = execFileSync('sh', ['-c', client], {
    input: sql,
    encoding: 'utf8',
  });
  if (output.trim().split('\n').at(-1) !== '1') {
    throw new Error(`moving ${rows} ${id} changed no row: ${output}`);
  }
}
