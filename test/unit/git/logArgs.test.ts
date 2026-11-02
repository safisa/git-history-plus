import { describe, expect, it } from 'vitest';
import { buildLogArgs, LOG_FORMAT } from '../../../src/git/logArgs';
import type { LogQuery } from '../../../src/shared/types';

const base: LogQuery = { branch: { kind: 'current' }, skip: 0, pageSize: 100 };
const build = (q: Partial<LogQuery> = {}, includeRemotes = false) =>
  buildLogArgs({ ...base, ...q }, { includeRemotes });

describe('buildLogArgs', () => {
  it('starts with the fixed prefix', () => {
    expect(build().slice(0, 7)).toEqual([
      '-c',
      'log.showSignature=false',
      'log',
      '-z',
      '--use-mailmap',
      '--date-order',
      `--format=${LOG_FORMAT}`,
    ]);
  });

  it('pages with pageSize+1', () => {
    const a = build({ skip: 200, pageSize: 100 });
    expect(a).toContain('--skip=200');
    expect(a).toContain('--max-count=101');
  });

  it('caps by maxCount remaining', () => {
    expect(build({ skip: 0, pageSize: 100, maxCount: 30 })).toContain('--max-count=30');
    expect(build({ skip: 90, pageSize: 100, maxCount: 100 })).toContain('--max-count=10');
    expect(build({ skip: 100, pageSize: 100, maxCount: 100 })).toContain('--max-count=0');
  });

  it('all branches', () => {
    const a = build({ branch: { kind: 'all' } });
    expect(a).toContain('--branches');
    expect(a).toContain('--tags');
    expect(a).not.toContain('--remotes');
    expect(a).not.toContain('HEAD');
    expect(build({ branch: { kind: 'all' } }, true)).toContain('--remotes');
  });

  it('ref goes after --end-of-options', () => {
    const a = build({ branch: { kind: 'ref', ref: '-n' } });
    const i = a.indexOf('--end-of-options');
    expect(i).toBeGreaterThan(-1);
    expect(a[i + 1]).toBe('-n');
  });

  it('current uses HEAD', () => {
    const a = build();
    expect(a[a.indexOf('--end-of-options') + 1]).toBe('HEAD');
  });

  it('author filter', () => {
    const a = build({ author: 'bob' });
    expect(a).toContain('--author=bob');
    expect(a).toContain('--regexp-ignore-case');
  });

  it('text filter is a literal match written as an escaped regex, not --fixed-strings', () => {
    const a = build({ text: 'a.b(' });
    expect(a).toContain('--grep=a[.]b[(]');
    // --fixed-strings would also make --author literal and break the author picker's pattern
    expect(a).not.toContain('--fixed-strings');
    expect(a).toContain('--regexp-ignore-case');
  });

  it('author is passed through as a pattern even with a text filter', () => {
    const a = build({ author: '<noa[+]git@example[.]com>', text: 'fix' });
    expect(a).toContain('--author=<noa[+]git@example[.]com>');
    expect(a).toContain('--grep=fix');
    expect(a).not.toContain('--fixed-strings');
  });

  it('since/until', () => {
    const a = build({ since: '2020-01-01', until: '2021-01-01' });
    expect(a).toContain('--since=2020-01-01');
    expect(a).toContain('--until=2021-01-01');
  });

  it('lines use -L and -s, no --follow, no path', () => {
    const a = build({ lines: { path: 'a/b.ts', start: 3, end: 9 }, follow: true, path: 'a/b.ts' });
    expect(a).toContain('-L3,9:a/b.ts');
    expect(a).toContain('-s');
    expect(a).not.toContain('--follow');
    expect(a).not.toContain('--');
  });

  it('follow with path', () => {
    const a = build({ path: 'f.txt', follow: true });
    expect(a).toContain('--follow');
    expect(a.slice(-2)).toEqual(['--', 'f.txt']);
  });

  it('no follow unless requested', () => {
    expect(build({ path: 'f.txt' })).not.toContain('--follow');
  });

  it('-- precedes a dash-leading path', () => {
    expect(build({ path: '--help.txt' }).slice(-2)).toEqual(['--', '--help.txt']);
  });

  it('options all precede --end-of-options', () => {
    const a = build({ author: 'x', text: 'y', since: 's', path: 'p', follow: true });
    const e = a.indexOf('--end-of-options');
    expect(a.indexOf('--author=x')).toBeLessThan(e);
    expect(a.indexOf('--follow')).toBeLessThan(e);
    expect(a.indexOf('--')).toBeGreaterThan(e);
  });

  it('never emits webview-supplied strings as bare argv elements', () => {
    const raw = ['--output=/x', '-x', '--exec=y', '-n', '--help'];
    const a = build({
      author: '--output=/x',
      text: '-x',
      since: '--exec=y',
      until: '-n',
      lines: { path: '--help', start: 1, end: 2 },
    });
    for (const r of raw) expect(a).not.toContain(r);
    expect(a).toContain('--author=--output=/x');
    expect(a).toContain('--grep=-x');
    expect(a).toContain('--since=--exec=y');
    expect(a).toContain('--until=-n');
    expect(a).toContain('-L1,2:--help');
  });

  it('puts a dash-leading path after --', () => {
    const a = build({ path: '--help' });
    expect(a.slice(-2)).toEqual(['--', '--help']);
  });
});
