import { describe, expect, it } from 'vitest';
import { parentDirs, partName, remotePaths } from './layout.ts';

describe('layout', () => {
  it('names the remote paths under a root', () => {
    const paths = remotePaths('/remote', 'site');
    expect(paths.site).toBe('/remote/site');
    expect(paths.state).toBe('/remote/.deploy/state.json');
    expect(paths.manifest('r1')).toBe('/remote/.deploy/manifests/r1.json');
    expect(paths.stagedFile('r1', 'impressum/index.html')).toBe(
      '/remote/.deploy/staged/r1/impressum/index.html',
    );
    expect(paths.siteFile('assets/a.css')).toBe('/remote/site/assets/a.css');
    expect(remotePaths('/', 'site').site).toBe('/site');
  });
  it('derives part names and parent directories', () => {
    expect(partName('assets/a.css')).toBe('assets/a.css.part');
    expect(parentDirs('a/b/c.html')).toEqual(['a', 'a/b']);
    expect(parentDirs('index.html')).toEqual([]);
  });
});
