import { afterEach, describe, expect, it } from 'vitest';
import { REFS_FORMAT, parseRefs } from '../../../src/git/refs';
import { makeRepo, type TestRepo } from '../../helpers/repo';

let repos: TestRepo[] = [];
afterEach(async () => {
  await Promise.all(repos.map((r) => r.cleanup()));
  repos = [];
});
async function repo(): Promise<TestRepo> {
  const r = await makeRepo();
  repos.push(r);
  return r;
}
const forEachRef = (r: TestRepo): Promise<string> => r.git('for-each-ref', `--format=${REFS_FORMAT}`);

describe('parseRefs', () => {
  it('handles branches, lightweight and annotated tags, current flag', async () => {
    const r = await repo();
    const h = await r.commit('a.txt', 'a', 'one');
    await r.git('tag', 'light');
    await r.git('tag', '-a', 'ann', '-m', 'annotated');
    await r.git('branch', 'other');
    const refs = parseRefs(await forEachRef(r));
    const by = (n: string) => refs.find((x) => x.name === n);
    expect(by('main')).toMatchObject({ kind: 'branch', target: h, current: true });
    expect(by('other')).toMatchObject({ kind: 'branch', target: h, current: false });
    expect(by('light')).toMatchObject({ kind: 'tag', target: h, fullName: 'refs/tags/light' });
    expect(by('ann')).toMatchObject({ kind: 'tag', target: h });
  });

  it('handles remote branches and skips remote HEAD', async () => {
    const up = await repo();
    const h = await up.commit('a.txt', 'a', 'one');
    const r = await repo();
    await r.commit('b.txt', 'b', 'local');
    await r.git('remote', 'add', 'origin', up.dir);
    await r.git('fetch', 'origin');
    await r.git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
    const refs = parseRefs(await forEachRef(r));
    expect(refs.filter((x) => x.kind === 'remote')).toEqual([
      {
        kind: 'remote',
        name: 'origin/main',
        fullName: 'refs/remotes/origin/main',
        target: h,
        current: false,
        remote: 'origin',
      },
    ]);
  });

  it('has no current branch on detached HEAD', async () => {
    const r = await repo();
    const h = await r.commit('a.txt', 'a', 'one');
    await r.git('checkout', '--detach', h);
    const refs = parseRefs(await forEachRef(r));
    expect(refs.some((x) => x.current)).toBe(false);
    expect(refs.find((x) => x.name === 'main')).toBeDefined();
  });
});
