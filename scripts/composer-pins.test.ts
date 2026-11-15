import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pinProblems, type ComposerJson } from './composer-pins.ts';

const composer: ComposerJson = {
  require: { php: '~8.3.0', 'ext-pdo': '*', 'slim/slim': '4.15.3' },
  'require-dev': { 'phpunit/phpunit': '12.5.44' },
};

describe('the Composer pins', () => {
  it('accepts exact versions for every installed package', () => {
    expect(
      pinProblems(composer, [
        { name: 'slim/slim', version: '4.15.3' },
        { name: 'phpunit/phpunit', version: '12.5.44' },
      ]),
    ).toEqual([]);
  });

  it('names a requirement that is a range, not an exact version', () => {
    expect(
      pinProblems({ require: { 'slim/slim': '^4.15' }, 'require-dev': {} }, [
        { name: 'slim/slim', version: '4.15.3' },
      ]),
    ).toEqual(['slim/slim: "^4.15" is not an exact version']);
  });

  it('names an installed package that composer.json does not pin (a floating transitive one)', () => {
    expect(
      pinProblems(composer, [
        { name: 'slim/slim', version: '4.15.3' },
        { name: 'nikic/fast-route', version: '1.3.0' },
      ]),
    ).toEqual(['nikic/fast-route 1.3.0 is installed but not pinned']);
  });

  it('reads an installed `v` tag as its version', () => {
    expect(
      pinProblems(composer, [{ name: 'slim/slim', version: 'v4.15.3' }]),
    ).toEqual([]);
  });

  it('names an installed version that differs from its pin', () => {
    expect(
      pinProblems(composer, [{ name: 'slim/slim', version: 'v4.15.4' }]),
    ).toEqual(['slim/slim: pinned 4.15.3, installed v4.15.4']);
  });

  it('pins every requirement of api/composer.json exactly', () => {
    const real = JSON.parse(
      readFileSync(new URL('../api/composer.json', import.meta.url), 'utf8'),
    ) as ComposerJson;

    expect(pinProblems(real, [])).toEqual([]);
  });
});
