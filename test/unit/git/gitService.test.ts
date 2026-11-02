import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { GitService } from '../../../src/git/gitService';
import { makeRepo, type TestRepo } from '../../helpers/repo';
import type { LogQuery } from '../../../src/shared/types';

let cfgDir: string;
let savedNoSystem: string | undefined;
let savedGlobal: string | undefined;
beforeAll(async () => {
  savedNoSystem = process.env.GIT_CONFIG_NOSYSTEM;
  savedGlobal = process.env.GIT_CONFIG_GLOBAL;
  cfgDir = await mkdtemp(join(tmpdir(), 'ghp-cfg-'));
  const empty = join(cfgDir, 'gitconfig');
  await writeFile(empty, '');
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  process.env.GIT_CONFIG_GLOBAL = empty;
});
afterAll(async () => {
  if (savedNoSystem === undefined) delete process.env.GIT_CONFIG_NOSYSTEM;
  else process.env.GIT_CONFIG_NOSYSTEM = savedNoSystem;
  if (savedGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
  else process.env.GIT_CONFIG_GLOBAL = savedGlobal;
  await rm(cfgDir, { recursive: true, force: true });
});

let repos: TestRepo[] = [];
let extra: string[] = [];
afterEach(async () => {
  await Promise.all(repos.map((r) => r.cleanup()));
  await Promise.all(extra.map((d) => rm(d, { recursive: true, force: true })));
  repos = [];
  extra = [];
});
async function repo(): Promise<TestRepo> {
  const r = await makeRepo();
  repos.push(r);
  return r;
}
const svc = (r: TestRepo) => new GitService(r.dir, 'git');
const q = (over: Partial<LogQuery> = {}): LogQuery => ({
  branch: { kind: 'current' },
  skip: 0,
  pageSize: 50,
  ...over,
});

describe('GitService.log', () => {
  it('returns an empty page for an empty repo', async () => {
    const r = await repo();
    const page = await svc(r).log(q(), false);
    expect(page).toMatchObject({ commits: [], graph: [], hasMore: false });
  });

  it('rejects on a non-repo directory', async () => {
    const notRepo = await mkdtemp(join(tmpdir(), 'ghp-norepo-'));
    extra.push(notRepo);
    const s = new GitService(notRepo, 'git');
    await expect(s.log(q(), false)).rejects.toThrow();
    await expect(s.resolveCommit('HEAD')).rejects.toThrow();
  });

  it('pages and attaches refs', async () => {
    const r = await repo();
    await r.commit('a.txt', '1', 'one');
    await r.commit('a.txt', '2', 'two');
    const h3 = await r.commit('a.txt', '3', 'three');
    await r.git('tag', 'v1');
    const s = svc(r);
    const p1 = await s.log(q({ pageSize: 2 }), false);
    expect(p1.commits.map((c) => c.subject)).toEqual(['three', 'two']);
    expect(p1.hasMore).toBe(true);
    expect(p1.commits[0]?.hash).toBe(h3);
    expect(p1.commits[0]?.refs.map((x) => x.name).sort()).toEqual(['main', 'v1']);
    const p2 = await s.log(q({ pageSize: 2, skip: 2 }), false);
    expect(p2.commits.map((c) => c.subject)).toEqual(['one']);
    expect(p2.hasMore).toBe(false);
    const capped = await s.log(q({ pageSize: 2, maxCount: 2 }), false);
    expect(capped.hasMore).toBe(false);
  });

  it('returns exactHash for a hash prefix', async () => {
    const r = await repo();
    const h = await r.commit('a.txt', '1', 'one');
    await r.commit('a.txt', '2', 'two');
    const page = await svc(r).log(q({ text: h.slice(0, 7) }), false);
    expect(page.exactHash).toBe(h);
    expect(page.commits.map((c) => c.hash)).toEqual([h]);
    expect(page.hasMore).toBe(false);
  });

  it('combines a picker author pattern with a text search', async () => {
    const r = await repo();
    const noa = { GIT_AUTHOR_NAME: 'Noa', GIT_AUTHOR_EMAIL: 'noa+git@example.com' };
    const hit = await r.commit('a.txt', '1', 'fix: the thing', noa);
    await r.commit('a.txt', '2', 'feat: other', noa);
    await r.commit('a.txt', '3', 'fix: by someone else');
    const page = await svc(r).log(q({ author: '<noa[+]git@example[.]com>', text: 'fix' }), false);
    expect(page.commits.map((c) => c.hash)).toEqual([hit]);
  });

  it('matches search text with regex metacharacters literally', async () => {
    const r = await repo();
    const dotted = await r.commit('a.txt', '1', 'call a.b( here');
    await r.commit('a.txt', '2', 'call axb( here');
    const boxed = await r.commit('a.txt', '3', 'todo [x] done');
    await r.commit('a.txt', '4', 'todo x done');
    const s = svc(r);
    expect((await s.log(q({ text: 'a.b(' }), false)).commits.map((c) => c.hash)).toEqual([dotted]);
    expect((await s.log(q({ text: '[x]' }), false)).commits.map((c) => c.hash)).toEqual([boxed]);
    expect((await s.log(q({ text: 'A.B(' }), false)).commits.map((c) => c.hash)).toEqual([dotted]);
    const slashed = await r.commit('a.txt', '5', 'path a\\b and ^start$');
    await r.commit('a.txt', '6', 'path ab and start');
    expect((await s.log(q({ text: 'a\\b' }), false)).commits.map((c) => c.hash)).toEqual([slashed]);
    expect((await s.log(q({ text: '^start$' }), false)).commits.map((c) => c.hash)).toEqual([slashed]);
  });

  it('falls back to message search for an unresolvable hash-like text', async () => {
    const r = await repo();
    await r.commit('a.txt', '1', 'one');
    const page = await svc(r).log(q({ text: 'deadbeef' }), false);
    expect(page.commits).toEqual([]);
    expect(page.exactHash).toBeUndefined();
  });

  it('draws a single-lane timeline when the list is filtered by file, text or author', async () => {
    const r = await repo();
    await r.commit('f.txt', '1', 'fix one');
    await r.commit('other.txt', '1', 'other');
    await r.commit('f.txt', '2', 'fix two');
    await r.commit('other.txt', '2', 'other again');
    await r.commit('f.txt', '3', 'fix three');
    for (const filter of [{ path: 'f.txt' }, { text: 'fix' }, { author: 'Test' }]) {
      const page = await svc(r).log(q(filter), false);
      expect(new Set(page.graph.map((g) => g.lane)), JSON.stringify(filter)).toEqual(new Set([0]));
      expect(
        page.graph.at(-1)!.segments.filter((s) => s.half === 'bottom'),
        JSON.stringify(filter),
      ).toEqual([]);
    }
  });

  it('keeps the full lane graph for the unfiltered history', async () => {
    const r = await repo();
    await r.commit('a.txt', '1', 'base');
    await r.git('checkout', '-b', 'side');
    await r.commit('b.txt', '1', 'side');
    await r.git('checkout', 'main');
    await r.commit('a.txt', '2', 'main');
    await r.git('merge', '--no-edit', '--no-ff', 'side');
    const page = await svc(r).log(q(), false);
    expect(Math.max(...page.graph.map((g) => g.lane))).toBe(1);
  });

  it('works on a shallow clone', async () => {
    const r = await repo();
    await r.commit('a.txt', '1', 'one');
    await r.commit('a.txt', '2', 'two');
    await r.commit('a.txt', '3', 'three');
    const dest = await mkdtemp(join(tmpdir(), 'ghp-shallow-'));
    extra.push(dest);
    const clone = join(dest, 'c');
    await r.git('clone', '--depth', '2', `file://${r.dir}`, clone);
    const page = await new GitService(clone, 'git').log(q(), false);
    expect(page.commits.map((c) => c.subject)).toEqual(['three', 'two']);
  });
});

describe('GitService details / diffFiles / show', () => {
  it('details on a root commit lists files with stats', async () => {
    const r = await repo();
    const h = await r.commit('a.txt', 'x\ny\n', 'root');
    const d = await svc(r).details(h);
    expect(d.commit.hash).toBe(h);
    expect(d.files).toEqual([{ status: 'A', path: 'a.txt', additions: 2, deletions: 0, binary: false }]);
  });

  it('details on a normal commit shows add, delete and rename', async () => {
    const r = await repo();
    await r.commit('old.txt', 'one\ntwo\nthree\nfour\n', 'base');
    await r.commit('keep.txt', 'k', 'keep');
    await r.git('mv', 'old.txt', 'moved.txt');
    await r.git('commit', '-m', 'rename');
    const head = (await r.git('rev-parse', 'HEAD')).trim();
    const d = await svc(r).details(head);
    expect(d.files).toMatchObject([{ status: 'R', path: 'moved.txt', oldPath: 'old.txt' }]);
  });

  it('details on a merge commit diffs against the first parent', async () => {
    const r = await repo();
    await r.commit('a.txt', 'a', 'base');
    await r.git('checkout', '-b', 'side');
    await r.commit('side.txt', 's', 'side');
    await r.git('checkout', 'main');
    await r.commit('main.txt', 'm', 'main');
    await r.git('merge', '--no-ff', 'side', '-m', 'merge');
    const head = (await r.git('rev-parse', 'HEAD')).trim();
    const d = await svc(r).details(head);
    expect(d.commit.parents).toHaveLength(2);
    expect(d.files.map((f) => [f.status, f.path])).toEqual([['A', 'side.txt']]);
  });

  it('diffFiles lists added and deleted files; handles odd names and binaries', async () => {
    const r = await repo();
    await r.commit('old.txt', 'o', 'a');
    const a = (await r.git('rev-parse', 'HEAD')).trim();
    await r.git('rm', 'old.txt');
    await r.commit('new.txt', 'n', 'b');
    await r.commit('my file.txt', 'sp', 'c');
    await r.commit('a\nb.txt', 'nl', 'd');
    await r.commit('bin.dat', 'a\0b', 'e');
    const b = (await r.git('rev-parse', 'HEAD')).trim();
    const files = await svc(r).diffFiles(a, b);
    const by = (p: string) => files.find((f) => f.path === p);
    expect(by('new.txt')?.status).toBe('A');
    expect(by('old.txt')?.status).toBe('D');
    expect(by('my file.txt')?.status).toBe('A');
    expect(by('a\nb.txt')?.status).toBe('A');
    expect(by('bin.dat')).toMatchObject({ status: 'A', binary: true });
  });

  it('show returns content, and empty Buffer only for a missing path', async () => {
    const r = await repo();
    const h = await r.commit('a.txt', 'hello', 'one');
    const s = svc(r);
    expect((await s.show(h, 'a.txt')).toString()).toBe('hello');
    expect((await s.show(h, 'nope.txt')).length).toBe(0);
    const notRepo = await mkdtemp(join(tmpdir(), 'ghp-norepo-'));
    extra.push(notRepo);
    await expect(new GitService(notRepo, 'git').show(h, 'a.txt')).rejects.toThrow();
  });
});

describe('GitService option injection (--end-of-options)', () => {
  it('show never treats a ref as an option (no --output file is written)', async () => {
    const r = await repo();
    await r.commit('a.txt', 'hello', 'one');
    const out = join(r.dir, 'pwned.txt');
    await expect(svc(r).show(`--output=${out}`, 'a.txt')).rejects.toThrow();
    expect(existsSync(out)).toBe(false);
  });
  it('diffFiles never treats a revision as an option', async () => {
    const r = await repo();
    const h = await r.commit('a.txt', 'hello', 'one');
    const out = join(r.dir, 'pwned.txt');
    await expect(svc(r).diffFiles(`--output=${out}`, h)).rejects.toThrow();
    expect(existsSync(out)).toBe(false);
  });
});

describe('GitService misc', () => {
  it('authors on a repository with no refs resolves (empty) instead of waiting on stdin', async () => {
    const r = await repo();
    await expect(svc(r).authors()).resolves.toEqual([]);
  }, 5000);

  it('authors respects .mailmap and sorts by count', async () => {
    const r = await repo();
    await writeFile(join(r.dir, '.mailmap'), 'Proper Name <proper@example.com> <old@example.com>\n');
    await r.commit('a.txt', '1', 'one', {
      GIT_AUTHOR_NAME: 'Old',
      GIT_AUTHOR_EMAIL: 'old@example.com',
    });
    await r.commit('a.txt', '2', 'two', {
      GIT_AUTHOR_NAME: 'Old',
      GIT_AUTHOR_EMAIL: 'old@example.com',
    });
    await r.commit('b.txt', '3', 'three');
    const authors = await svc(r).authors();
    expect(authors[0]).toEqual({ name: 'Proper Name', email: 'proper@example.com' });
    expect(authors).toHaveLength(2);
  });

  it('caches refs until invalidate and resolves commits', async () => {
    const r = await repo();
    const h = await r.commit('a.txt', '1', 'one');
    const s = svc(r);
    expect((await s.refs()).map((x) => x.name)).toEqual(['main']);
    await r.git('branch', 'later');
    expect((await s.refs()).map((x) => x.name)).toEqual(['main']);
    s.invalidate();
    expect((await s.refs()).map((x) => x.name).sort()).toEqual(['later', 'main']);
    expect(await s.resolveCommit('main')).toBe(h);
    expect(await s.resolveCommit('nonexistent')).toBeUndefined();
  });

  it('fileHistory follows renames', async () => {
    const r = await repo();
    const h1 = await r.commit('a.txt', 'one\ntwo\nthree\nfour\nfive\n', 'one');
    await r.git('mv', 'a.txt', 'b.txt');
    await r.git('commit', '-m', 'rename');
    const h2 = (await r.git('rev-parse', 'HEAD')).trim();
    expect(await svc(r).fileHistory('b.txt')).toEqual([h2, h1]);
  });
});

describe('GitService.log graph', () => {
  it('fills graph rows and continues across pages via carry', async () => {
    const r = await repo();
    await r.commit('a.txt', '1', 'one');
    await r.commit('a.txt', '2', 'two');
    await r.commit('a.txt', '3', 'three');
    const s = svc(r);
    const all = await s.log(q(), false);
    expect(all.graph.length).toBe(all.commits.length);
    const p1 = await s.log(q({ pageSize: 2 }), false);
    const p2 = await s.log(q({ pageSize: 2, skip: 2, graphCarry: p1.carry }), false);
    expect([...p1.graph, ...p2.graph]).toEqual(all.graph);
  });
});

describe('GitService.stateFingerprint', () => {
  it('is stable across no-op calls and changes with HEAD, refs, the branch and which files are changed', async () => {
    const r = await repo();
    await r.commit('a.txt', '1', 'one');
    const s = svc(r);
    const first = await s.stateFingerprint();
    expect(await s.stateFingerprint()).toBe(first);
    await writeFile(join(r.dir, 'a.txt'), 'dirty'); // the file now has uncommitted changes
    const a = await s.stateFingerprint();
    expect(a).not.toBe(first);
    await writeFile(join(r.dir, 'a.txt'), 'dirtier'); // the same file changed again: same rows
    expect(await s.stateFingerprint()).toBe(a);
    await r.git('branch', 'other');
    const b = await s.stateFingerprint();
    expect(b).not.toBe(a);
    await r.git('checkout', '-q', 'other'); // same commit, different current branch
    const c = await s.stateFingerprint();
    expect(c).not.toBe(b);
    await r.commit('a.txt', '2', 'two');
    expect(await s.stateFingerprint()).not.toBe(c);
  });

  it('works on an empty repository', async () => {
    const r = await repo();
    await expect(svc(r).stateFingerprint()).resolves.toEqual(expect.any(String));
  });
});

/** True when ssh-keygen can make a key here (it signs the commits for the showSignature test). */
const hasSshKeygen = (() => {
  try {
    execFileSync('ssh-keygen', ['-?'], { stdio: 'ignore' });
    return true;
  } catch (e) {
    // ssh-keygen -? exits non-zero after printing usage; only a missing binary is fatal.
    return (e as NodeJS.ErrnoException).code !== 'ENOENT';
  }
})();

describe('GitService with log.showSignature=true', () => {
  it.skipIf(!hasSshKeygen)('details, log and fileHistory still parse signed commits', async () => {
    const r = await repo();
    const keyDir = await mkdtemp(join(tmpdir(), 'ghp-key-'));
    extra.push(keyDir);
    const key = join(keyDir, 'key');
    execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', key], { stdio: 'ignore' });
    await r.git('config', 'gpg.format', 'ssh');
    await r.git('config', 'user.signingkey', key);
    await r.git('config', 'commit.gpgsign', 'true');
    const h1 = await r.commit('a.txt', '1\n', 'one');
    const h2 = await r.commit('a.txt', '2\n', 'two');
    await r.git('config', 'log.showSignature', 'true');
    const s = svc(r);
    const d = await s.details(h2);
    expect(d.commit.hash).toBe(h2);
    expect(d.commit.subject).toBe('two');
    expect(d.files.map((f) => f.path)).toEqual(['a.txt']);
    expect(await s.fileHistory('a.txt')).toEqual([h2, h1]);
    expect((await s.log(q(), false)).commits.map((c) => c.hash)).toEqual([h2, h1]);
    expect((await s.log(q({ text: h1.slice(0, 8) }), false)).commits[0]?.subject).toBe('one');
  });
});
