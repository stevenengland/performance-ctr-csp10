import {
  hostNameOf,
  isNonEmptyString,
  requiredVariable,
  type Env,
} from './parse.ts';

/**
What the API reads at runtime from the file the deploy renders outside the web
root: the database login and the bootstrap admin. Every field but the database
host comes from a GitHub secret.
*/
export interface RuntimeConfig {
  db: { host: string; name: string; user: string; password: string };
  bootstrapAdmin: { user: string; passwordHash: string };
}

/** The secrets the runtime configuration is rendered from; the cli masks their values in every line it prints. */
export const RUNTIME_SECRETS = [
  'DB_NAME',
  'DB_USER',
  'DB_PASS',
  'BOOTSTRAP_ADMIN_USER',
  'BOOTSTRAP_ADMIN_PASSWORD_HASH',
] as const;

// What PHP's password_hash() produces with the default or an Argon2 algorithm.
const PASSWORD_HASH = /^\$(?:2y|argon2i|argon2id)\$\S+$/;

function secret(env: Env, name: (typeof RUNTIME_SECRETS)[number]): string {
  const value = env[name];
  if (!isNonEmptyString(value)) {
    throw new Error(`Missing repository secret ${name}`);
  }
  return value;
}

/** The runtime configuration from `DB_HOST` and the secrets; errors name the variable, never its value. */
export function parseRuntimeConfig(env: Env): RuntimeConfig {
  const host = hostNameOf(
    'DB_HOST',
    requiredVariable(env, 'DB_HOST', 'repository'),
  );
  const passwordHash = secret(env, 'BOOTSTRAP_ADMIN_PASSWORD_HASH');
  if (!PASSWORD_HASH.test(passwordHash)) {
    throw new Error(
      'Invalid repository secret BOOTSTRAP_ADMIN_PASSWORD_HASH: expected the output of PHP password_hash()',
    );
  }
  return {
    db: {
      host,
      name: secret(env, 'DB_NAME'),
      user: secret(env, 'DB_USER'),
      password: secret(env, 'DB_PASS'),
    },
    bootstrapAdmin: { user: secret(env, 'BOOTSTRAP_ADMIN_USER'), passwordHash },
  };
}
