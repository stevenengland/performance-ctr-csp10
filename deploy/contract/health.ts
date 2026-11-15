import { isNonEmptyString, parseJson } from './parse.ts';
import type { TargetPolicy } from './policy.ts';

export type MigrationState = 'ok' | 'running' | 'failed';
const MIGRATION_STATES: readonly string[] = ['ok', 'running', 'failed'];

/** What `GET /api/health` reports (api/openapi.yaml, schema Health). */
export interface HealthReport {
  appVersion: string;
  phpVersion: string;
  database: { engine: string; version: string };
  schemaVersion: number;
  migration: MigrationState;
  minClientVersion: string;
}

/** What the deploy expects the release behind the API pointer to report. */
export interface ExpectedHealth {
  appVersion: string;
  schemaVersion: number;
}

export function healthUrl(policy: Pick<TargetPolicy, 'origin' | 'base'>) {
  return `${policy.origin}${policy.base}api/health`;
}

const malformed = (field: string) =>
  new Error(`health response is malformed: ${field}`);

function isMigrationState(value: unknown): value is MigrationState {
  return typeof value === 'string' && MIGRATION_STATES.includes(value);
}

function toDatabase(value: unknown): HealthReport['database'] {
  if (typeof value !== 'object' || value === null) throw malformed('database');
  const { engine, version } = value as Record<string, unknown>;
  if (!isNonEmptyString(engine) || !isNonEmptyString(version)) {
    throw malformed('database');
  }
  return { engine, version };
}

/** Every field health must answer with; a missing or mistyped one names itself. */
export function parseHealth(json: string): HealthReport {
  let value: unknown;
  try {
    value = parseJson(json, 'health response');
  } catch {
    throw malformed('not JSON');
  }
  if (typeof value !== 'object' || value === null) {
    throw malformed('not an object');
  }
  const record = value as Record<string, unknown>;
  const text = (name: 'appVersion' | 'phpVersion' | 'minClientVersion') => {
    const field = record[name];
    if (!isNonEmptyString(field)) throw malformed(name);
    return field;
  };
  const appVersion = text('appVersion');
  const phpVersion = text('phpVersion');
  const database = toDatabase(record.database);
  const { schemaVersion, migration } = record;
  if (
    typeof schemaVersion !== 'number' ||
    !Number.isSafeInteger(schemaVersion)
  ) {
    throw malformed('schemaVersion');
  }
  if (!isMigrationState(migration)) throw malformed('migration');
  return {
    appVersion,
    phpVersion,
    database,
    schemaVersion,
    migration,
    minClientVersion: text('minClientVersion'),
  };
}

/** Why the report does not show the expected release with its schema migrated, or undefined when it does. */
export function healthProblem(
  report: HealthReport,
  expected: ExpectedHealth,
): string | undefined {
  if (report.migration !== 'ok') {
    return `migration ${report.migration} at schema version ${String(report.schemaVersion)}`;
  }
  if (report.appVersion !== expected.appVersion) {
    return `app version ${report.appVersion}, expected ${expected.appVersion}`;
  }
  if (report.schemaVersion !== expected.schemaVersion) {
    return `schema version ${String(report.schemaVersion)}, expected ${String(expected.schemaVersion)}`;
  }
  return undefined;
}
