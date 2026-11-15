export type Env = Readonly<Record<string, string | undefined>>;

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

/** Parses the JSON text of `file`; a syntax error reads as "<file> is malformed: not JSON". */
export function parseJson(json: string, file: string): unknown {
  try {
    return JSON.parse(json);
  } catch (error) {
    throw new Error(`${file} is malformed: not JSON`, { cause: error });
  }
}

/** A non-empty variable, or an error naming it: "Missing <kind> variable <name>". */
export function requiredVariable(
  env: Env,
  name: string,
  kind: 'environment' | 'repository',
): string {
  const value = env[name];
  if (!isNonEmptyString(value)) {
    throw new Error(`Missing ${kind} variable ${name}`);
  }
  return value;
}

/** A lowercase DNS host name: dot-separated labels of letters, digits and inner hyphens. */
export function isHostName(value: string): boolean {
  return (
    value.length <= 253 &&
    value
      .split('.')
      .every(
        (label) =>
          /^[a-z\d-]{1,63}$/.test(label) &&
          !label.startsWith('-') &&
          !label.endsWith('-'),
      )
  );
}

function invalidRepositoryVariable(name: string, expected: string): Error {
  return new Error(`Invalid repository variable ${name}: expected ${expected}`);
}

/** The port in `name`, `fallback` when unset or empty. */
export function portVariable(env: Env, name: string, fallback: number): number {
  const value = env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!/^\d+$/.test(value) || parsed < 1 || parsed > 65_535) {
    throw invalidRepositoryVariable(name, 'an integer between 1 and 65535');
  }
  return parsed;
}

/** `value` when it is a host name, or an error naming the variable it came from. */
export function hostNameOf(name: string, value: string): string {
  if (!isHostName(value)) {
    throw invalidRepositoryVariable(name, 'a lowercase host name');
  }
  return value;
}
