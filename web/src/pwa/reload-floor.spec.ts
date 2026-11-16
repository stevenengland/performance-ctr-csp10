import { beforeEach, describe, expect, it } from 'vitest';
import {
  checkClientVersion,
  isOlderThan,
  resetReloadFloor,
  useReloadFloor,
} from './reload-floor';

describe('the reload floor', () => {
  beforeEach(() => {
    resetReloadFloor();
  });

  it.each([
    ['0.1.0+abc', '0.2.0', true],
    ['0.9.9', '0.10.0', true],
    ['1.0.0', '0.10.0', false],
    ['0.1.0+abc', '0.1.0', false],
    ['0.1.0+dev', '0.1.0', false],
    ['0.1.1', '0.1.0', false],
  ])('client %s is older than %s: %s', (client, minimum, older) => {
    expect(isOlderThan(client, minimum)).toBe(older);
  });

  it('blocks a client below the minimum the server reports', () => {
    checkClientVersion('0.1.0+abc', '0.2.0');

    expect(useReloadFloor().value).toBe(true);
  });

  it('stays away for a current client', () => {
    checkClientVersion('0.2.0+abc', '0.2.0');

    expect(useReloadFloor().value).toBe(false);
  });
});
