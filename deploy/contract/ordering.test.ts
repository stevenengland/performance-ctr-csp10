import { describe, expect, it } from 'vitest';
import { orderRelease, parseInspection, strictest } from './ordering.ts';

const candidate = 'c'.repeat(40);
const active = 'a'.repeat(40);

describe('orderRelease', () => {
  it.each([[{ kind: 'none' }], [{ kind: 'descendant' }]] as const)(
    'deploys when the ancestry is %o',
    (ancestry) => {
      expect(orderRelease({ candidate, active, ancestry })).toEqual({
        action: 'deploy',
      });
    },
  );

  it('skips a candidate that an overtaking run already superseded', () => {
    expect(
      orderRelease({ candidate, active, ancestry: { kind: 'ancestor' } }),
    ).toEqual({
      action: 'skip',
      message: `production is at ${active}, which is newer than ${candidate}; skipped so production never regresses`,
    });
  });

  it('fails a candidate outside the active commit history', () => {
    expect(
      orderRelease({ candidate, active, ancestry: { kind: 'unrelated' } }),
    ).toEqual({
      action: 'fail',
      message: `production is at ${active} and ${candidate} is neither its descendant nor its ancestor; production moves backward only through the rollback workflow`,
    });
  });

  it('fails, never skips, when the order is unknown', () => {
    expect(
      orderRelease({
        candidate,
        active,
        ancestry: { kind: 'unknown', code: 128 },
      }),
    ).toEqual({
      action: 'fail',
      message: `cannot order ${candidate} against the active ${active} (git merge-base exit 128)`,
    });
  });
});

describe('an in-progress release', () => {
  it('skips a candidate it is newer than, naming it', () => {
    expect(
      orderRelease({
        candidate,
        active,
        ancestry: { kind: 'ancestor' },
        inProgress: true,
      }),
    ).toEqual({
      action: 'skip',
      message: `release ${active} is in progress on production and is newer than ${candidate}; skipped so production never regresses`,
    });
  });

  it('the strictest order wins: fail over skip over deploy', () => {
    const deploy = { action: 'deploy' } as const;
    const skip = { action: 'skip', message: 's' } as const;
    const fail = { action: 'fail', message: 'f' } as const;
    expect(strictest([deploy, deploy])).toEqual(deploy);
    expect(strictest([deploy, skip])).toEqual(skip);
    expect(strictest([skip, fail, deploy])).toEqual(fail);
    expect(strictest([])).toEqual(deploy);
  });
});

describe('parseInspection', () => {
  it('reads an in-progress release beside the active one', () => {
    const inspection = {
      active: { releaseId: '20261022T193000Z-aaaaaaa', commit: active },
      inProgress: { releaseId: '20261023T193000Z-ccccccc', commit: candidate },
      retained: ['20261022T193000Z-aaaaaaa'],
    };
    expect(parseInspection(JSON.stringify(inspection), 'remote.json')).toEqual(
      inspection,
    );
  });

  it('reads the active release and the retained ids', () => {
    const inspection = {
      active: { releaseId: '20261022T193000Z-aaaaaaa', commit: active },
      retained: ['20261022T193000Z-aaaaaaa'],
    };
    expect(parseInspection(JSON.stringify(inspection), 'remote.json')).toEqual(
      inspection,
    );
  });

  it('reads a host without an active release', () => {
    expect(
      parseInspection(JSON.stringify({ retained: [] }), 'remote.json'),
    ).toEqual({ retained: [] });
  });

  it.each([
    ['not JSON', '{', 'not JSON'],
    ['a list', '[]', 'not an object'],
    ['no retained ids', '{}', 'retained'],
    [
      'an active commit that is no sha',
      JSON.stringify({
        active: { releaseId: 'x', commit: '--upload-pack=x' },
        retained: [],
      }),
      'active.commit',
    ],
    [
      'an in-progress commit that is no sha',
      JSON.stringify({
        inProgress: { releaseId: 'x', commit: 'HEAD' },
        retained: [],
      }),
      'inProgress.commit',
    ],
  ])('rejects %s', (_name, json, problem) => {
    expect(() => parseInspection(json, 'remote.json')).toThrow(
      `remote.json is malformed: ${problem}`,
    );
  });
});
