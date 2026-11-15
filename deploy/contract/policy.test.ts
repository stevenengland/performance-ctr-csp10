import { describe, expect, it } from 'vitest';
import {
  CACHING,
  parsePolicy,
  parseSiteUrl,
  parseWebspaceSettings,
  type Env,
} from './policy.ts';

const env: Env = {
  SITE_URL: 'https://www.example.test',
  REMOTE_ROOT: '/prod',
};

describe('parseSiteUrl', () => {
  it.each([
    ['http://h.test', 'http://h.test', '/'],
    ['http://h.test/', 'http://h.test', '/'],
    ['https://h.test/preview', 'https://h.test', '/preview/'],
    ['https://h.test/preview/', 'https://h.test', '/preview/'],
  ])('%s → origin %s, base %s', (value, origin, base) => {
    expect(parseSiteUrl(value)).toEqual({ origin, base });
  });

  it.each([
    'ftp://h.test',
    'h.test',
    'http://h.test/?x=1',
    'http://h.test/#top',
  ])('rejects %s', (value) => {
    expect(() => parseSiteUrl(value)).toThrow(/http:\/\/ or https:\/\//);
  });
});

describe('parsePolicy', () => {
  it('returns the production policy from SITE_URL', () => {
    expect(
      parsePolicy({ ...env, SITE_URL: 'https://www.example.test/app' }),
    ).toEqual({
      origin: 'https://www.example.test',
      base: '/app/',
      caching: CACHING,
      assetDir: 'assets',
    });
  });

  it("reads the hashed-asset folder from ASSET_DIR, defaulting to Vite's assets", () => {
    expect(parsePolicy(env).assetDir).toBe('assets');
    expect(parsePolicy({ ...env, ASSET_DIR: '' }).assetDir).toBe('assets');
    expect(parsePolicy({ ...env, ASSET_DIR: '_build' }).assetDir).toBe(
      '_build',
    );
  });

  it.each(['assets/', '/assets', 'a/b', '.', '..', 'as sets', 'assets*'])(
    'rejects hashed-asset folder %j naming the variable',
    (assetDir) => {
      expect(() => parsePolicy({ ...env, ASSET_DIR: assetDir })).toThrow(
        /^Invalid repository variable ASSET_DIR: expected one folder name/,
      );
    },
  );

  it('names a missing and an invalid SITE_URL', () => {
    expect(() => parsePolicy({ ...env, SITE_URL: '' })).toThrow(
      /^Missing repository variable SITE_URL$/,
    );
    expect(() => parsePolicy({ ...env, SITE_URL: 'www.example.test' })).toThrow(
      /^Invalid repository variable SITE_URL: expected an http:\/\/ or https:\/\//,
    );
  });
});

describe('parseWebspaceSettings', () => {
  it('returns the remote root, the served folder and no aliases', () => {
    expect(parseWebspaceSettings(env)).toEqual({
      remoteRoot: '/prod',
      docroot: 'site',
      aliases: [],
    });
  });

  it('defaults the remote root to the SFTP root and reads empty values as unset', () => {
    expect(parseWebspaceSettings({ REMOTE_ROOT: '', DOCROOT: '' })).toEqual({
      remoteRoot: '/',
      docroot: 'site',
      aliases: [],
    });
  });

  it('needs no host, port, login or known hosts', () => {
    expect(() => parseWebspaceSettings({})).not.toThrow();
  });

  it('rejects a relative remote root naming the variable', () => {
    expect(() => parseWebspaceSettings({ REMOTE_ROOT: 'prod' })).toThrow(
      /^Invalid repository variable REMOTE_ROOT: expected an absolute path$/,
    );
  });

  it('reads a served folder name', () => {
    expect(parseWebspaceSettings({ ...env, DOCROOT: 'httpdocs' }).docroot).toBe(
      'httpdocs',
    );
  });

  it.each([
    'httpdocs/',
    '/httpdocs',
    'a/b',
    '.',
    '..',
    '.deploy',
    'httpdocs\n',
    'http\tdocs',
    'http\u{7F}docs',
    'web root',
    'web[1]',
    'web*',
    String.raw`web\root`,
    'wëb',
  ])('rejects served folder %j naming the variable', (docroot) => {
    expect(() => parseWebspaceSettings({ ...env, DOCROOT: docroot })).toThrow(
      /^Invalid repository variable DOCROOT: expected one folder name/,
    );
  });

  it('reads the declared aliases as host names', () => {
    expect(
      parseWebspaceSettings({
        ...env,
        SITE_ALIASES: 'www.example.test, alt-1.example.test',
      }).aliases,
    ).toEqual(['www.example.test', 'alt-1.example.test']);
  });

  it.each([
    'www.example.test,',
    'https://www.example.test',
    'www.example.test/',
    'www example.test',
    '-www.example.test',
    'www..example.test',
    'WWW.example.test',
    'www.example.test:443',
  ])('rejects alias list %j naming the variable', (aliases) => {
    expect(() =>
      parseWebspaceSettings({ ...env, SITE_ALIASES: aliases }),
    ).toThrow(
      /^Invalid repository variable SITE_ALIASES: expected comma-separated lowercase host names$/,
    );
  });
});
