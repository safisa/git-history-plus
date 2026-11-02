import { describe, expect, it } from 'vitest';
import { mergeStats, parseFollowLog, parseNameStatus, parseNumstat } from '../../../src/git/diffParser';

describe('parseNameStatus', () => {
  it('parses add, modify, delete', () => {
    expect(parseNameStatus('A\0a.txt\0M\0b.txt\0D\0c.txt\0')).toEqual([
      { status: 'A', path: 'a.txt' },
      { status: 'M', path: 'b.txt' },
      { status: 'D', path: 'c.txt' },
    ]);
  });
  it('parses rename with score and oldPath', () => {
    expect(parseNameStatus('R100\0old.txt\0new.txt\0M\0x\0')).toEqual([
      { status: 'R', path: 'new.txt', oldPath: 'old.txt' },
      { status: 'M', path: 'x' },
    ]);
  });
  it('keeps spaces and newlines in names', () => {
    expect(parseNameStatus('A\0my file.txt\0A\0a\nb.txt\0')).toEqual([
      { status: 'A', path: 'my file.txt' },
      { status: 'A', path: 'a\nb.txt' },
    ]);
  });
});

describe('parseNumstat / mergeStats', () => {
  it('parses counts, binary and renames', () => {
    const m = parseNumstat('1\t2\ta.txt\0-\t-\timg.png\x000\t0\t\0old.txt\0new.txt\0');
    expect(m.get('a.txt')).toEqual({ additions: 1, deletions: 2, binary: false });
    expect(m.get('img.png')).toEqual({ binary: true });
    expect(m.get('new.txt')).toEqual({ additions: 0, deletions: 0, binary: false });
  });
  it('merges onto files', () => {
    const m = parseNumstat('3\t1\ta.txt\0-\t-\timg.png\0');
    expect(
      mergeStats(
        [
          { status: 'M', path: 'a.txt' },
          { status: 'A', path: 'img.png' },
          { status: 'D', path: 'z' },
        ],
        m,
      ),
    ).toEqual([
      { status: 'M', path: 'a.txt', additions: 3, deletions: 1, binary: false },
      { status: 'A', path: 'img.png', binary: true },
      { status: 'D', path: 'z' },
    ]);
  });
});

describe('parseFollowLog', () => {
  const h = (c: string) => c.repeat(40);
  it('parses status and paths per commit, renames carrying oldPath', () => {
    const raw = `${h('a')}\0\nD\0b.txt\0${h('b')}\0\nM\0b.txt\0${h('c')}\0\nR100\0a.txt\0b.txt\0${h('d')}\0\nA\0a.txt\0`;
    expect(parseFollowLog(raw, 'b.txt')).toEqual([
      { hash: h('a'), status: 'D', path: 'b.txt' },
      { hash: h('b'), status: 'M', path: 'b.txt' },
      { hash: h('c'), status: 'R', path: 'b.txt', oldPath: 'a.txt' },
      { hash: h('d'), status: 'A', path: 'a.txt' },
    ]);
  });
  it('keeps the expected path for a commit with no file line (a merge)', () => {
    const raw = `${h('a')}\0\nM\0b.txt\0${h('b')}\0${h('c')}\0\nR090\0a.txt\0b.txt\0${h('d')}\0\nA\0a.txt\0`;
    const v = parseFollowLog(raw, 'b.txt');
    expect(v[1]).toEqual({ hash: h('b'), status: 'M', path: 'b.txt' });
    expect(v.map((x) => x.path)).toEqual(['b.txt', 'b.txt', 'b.txt', 'a.txt']);
  });
  it('accepts sha256 hashes and file names that look like hashes', () => {
    const long = 'e'.repeat(64);
    const raw = `${long}\0\nA\0${h('f')}\0`;
    expect(parseFollowLog(raw, h('f'))).toEqual([{ hash: long, status: 'A', path: h('f') }]);
  });
  it('returns nothing for empty output', () => {
    expect(parseFollowLog('', 'a.txt')).toEqual([]);
  });
});
