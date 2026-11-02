import { afterEach, describe, expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildLogArgs } from '../../../src/git/logArgs';
import { parseLog } from '../../../src/git/logParser';
import { makeRepo, type TestRepo } from '../../helpers/repo';

const repos: TestRepo[] = [];
async function repo(opts?: { sha256?: boolean }) {
  const r = await makeRepo(opts);
  repos.push(r);
  return r;
}
afterEach(async () => {
  await Promise.all(repos.splice(0).map((r) => r.cleanup()));
});

async function log(r: TestRepo) {
  const args = buildLogArgs(
    { branch: { kind: 'current' }, skip: 0, pageSize: 100 },
    { includeRemotes: false },
  );
  return parseLog(await r.git(...args));
}

describe('parseLog', () => {
  it('returns [] for empty output', () => {
    expect(parseLog('')).toEqual([]);
  });

  it('parses root commit with no parents and dates in ms', async () => {
    const r = await repo();
    const h = await r.commit('a.txt', 'a', 'root');
    const c = (await log(r))[0]!;
    expect(c.hash).toBe(h);
    expect(c.parents).toEqual([]);
    expect(c.subject).toBe('root');
    expect(c.body).toBe('');
    expect(c.author).toEqual({ name: 'Test User', email: 'test@example.com' });
    expect(c.authorDate % 1000).toBe(0);
    expect(c.authorDate).toBeGreaterThan(1.5e12);
  });

  it('parses merge commit parents in order', async () => {
    const r = await repo();
    const root = await r.commit('a.txt', 'a', 'root');
    await r.git('checkout', '-b', 'side');
    const side = await r.commit('b.txt', 'b', 'side');
    await r.git('checkout', 'main');
    const main = await r.commit('c.txt', 'c', 'main');
    await r.git('merge', '--no-ff', '-m', 'merge', 'side');
    const commits = await log(r);
    expect(commits).toHaveLength(4);
    expect(commits[0]!.subject).toBe('merge');
    expect(commits[0]!.parents).toEqual([main, side]);
    expect(commits[3]!.hash).toBe(root);
  });

  it('handles unicode author and emoji subject', async () => {
    const r = await repo();
    await r.commit('a.txt', 'a', 'fix: 🎉 emoji', {
      GIT_AUTHOR_NAME: 'Zoë Ünal',
      GIT_AUTHOR_EMAIL: 'zoe@example.com',
    });
    const c = (await log(r))[0]!;
    expect(c.author.name).toBe('Zoë Ünal');
    expect(c.subject).toBe('fix: 🎉 emoji');
  });

  it('normalizes CRLF and keeps multi-paragraph body', async () => {
    const r = await repo();
    await r.commit('a.txt', 'a', 'subject\r\n\r\nline1\r\n\r\nline2');
    const c = (await log(r))[0]!;
    expect(c.subject).toBe('subject');
    expect(c.body).toBe('line1\n\nline2');
  });

  it('preserves \\x1f inside the body', async () => {
    const r = await repo();
    await r.commit('a.txt', 'a', 'subject\n\nbefore\x1fafter');
    const c = (await log(r))[0]!;
    expect(c.body).toBe('before\x1fafter');
  });

  it('honors .mailmap', async () => {
    const r = await repo();
    await writeFile(join(r.dir, '.mailmap'), 'New <new@x> Old <old@x>\n');
    await r.commit('a.txt', 'a', 'c1', { GIT_AUTHOR_NAME: 'Old', GIT_AUTHOR_EMAIL: 'old@x' });
    const c = (await log(r))[0]!;
    expect(c.author).toEqual({ name: 'New', email: 'new@x' });
  });

  it('parses 64-char sha256 hashes', async () => {
    const r = await repo({ sha256: true });
    const h = await r.commit('a.txt', 'a', 'c1');
    const c = (await log(r)).at(0)!;
    expect(c.hash).toHaveLength(64);
    expect(c.hash).toBe(h);
  });

  it('parses several commits separated by NUL', async () => {
    const r = await repo();
    await r.commit('a.txt', 'a', 'one');
    await r.commit('a.txt', 'b', 'two\n\nbody');
    const commits = await log(r);
    expect(commits.map((c) => c.subject)).toEqual(['two', 'one']);
    expect(commits[0]!.body).toBe('body');
  });
});
