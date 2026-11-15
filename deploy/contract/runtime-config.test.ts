import { describe, expect, it } from 'vitest';
import { parseRuntimeConfig } from './runtime-config.ts';

const env = {
  DB_HOST: 'database-5012345678.webspace-host.com',
  DB_NAME: 'dbs123',
  DB_USER: 'dbu123',
  DB_PASS: "pa'ss\\word",
  BOOTSTRAP_ADMIN_USER: 'owner',
  BOOTSTRAP_ADMIN_PASSWORD_HASH:
    '$2y$12$abcdefghijklmnopqrstuuJ0123456789abcdefghijklmnopqrs',
};

describe('parseRuntimeConfig', () => {
  it('reads the database login and the bootstrap admin', () => {
    expect(parseRuntimeConfig(env)).toEqual({
      db: {
        host: 'database-5012345678.webspace-host.com',
        name: 'dbs123',
        user: 'dbu123',
        password: "pa'ss\\word",
      },
      bootstrapAdmin: {
        user: 'owner',
        passwordHash: env.BOOTSTRAP_ADMIN_PASSWORD_HASH,
      },
    });
  });

  it.each([
    [{ DB_HOST: '' }, 'Missing repository variable DB_HOST'],
    [{ DB_HOST: 'db host' }, 'Invalid repository variable DB_HOST'],
    [{ DB_NAME: '' }, 'Missing repository secret DB_NAME'],
    [{ DB_USER: undefined }, 'Missing repository secret DB_USER'],
    [{ DB_PASS: '' }, 'Missing repository secret DB_PASS'],
    [
      { BOOTSTRAP_ADMIN_USER: '' },
      'Missing repository secret BOOTSTRAP_ADMIN_USER',
    ],
    [
      { BOOTSTRAP_ADMIN_PASSWORD_HASH: '' },
      'Missing repository secret BOOTSTRAP_ADMIN_PASSWORD_HASH',
    ],
  ])('rejects %j naming the variable', (override, message) => {
    expect(() => parseRuntimeConfig({ ...env, ...override })).toThrow(message);
  });

  it('rejects a bootstrap password that is not a hash, without echoing it', () => {
    let message = '';
    try {
      parseRuntimeConfig({
        ...env,
        BOOTSTRAP_ADMIN_PASSWORD_HASH: 'plain-text-password',
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toBe(
      'Invalid repository secret BOOTSTRAP_ADMIN_PASSWORD_HASH: expected the output of PHP password_hash()',
    );
  });
});
