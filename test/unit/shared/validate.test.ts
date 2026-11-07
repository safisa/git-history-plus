import { describe, expect, it } from 'vitest';
import { isHash, isSafeRefName, validateRequest } from '../../../src/shared/validate';
import { LOG_COUNT_MAX } from '../../../src/shared/protocol';

describe('isHash', () => {
  it('accepts 4..64 lowercase hex', () => {
    expect(isHash('abcd')).toBe(true);
    expect(isHash('a'.repeat(64))).toBe(true);
  });
  it('rejects uppercase, short, long, non-strings', () => {
    expect(isHash('ABCD1234')).toBe(false);
    expect(isHash('abc')).toBe(false);
    expect(isHash('a'.repeat(65))).toBe(false);
    expect(isHash('HEAD')).toBe(false);
    expect(isHash(12345)).toBe(false);
  });
});

describe('isSafeRefName', () => {
  it.each(['feature/x', 'v1.2.3', 'release/2.0'])('accepts %s', (s) => {
    expect(isSafeRefName(s)).toBe(true);
  });
  it.each([
    ['empty', ''],
    ['leading dash', '--force'],
    ['dotdot', 'a..b'],
    ['reflog', 'a@{1}'],
    ['double slash', 'a//b'],
    ['trailing slash', 'a/'],
    ['trailing dot', 'a.'],
    ['trailing .lock', 'a.lock'],
    ['space', 'a b'],
    ['tilde', 'a~1'],
    ['caret', 'a^'],
    ['colon', 'a:b'],
    ['question', 'a?'],
    ['star', 'a*'],
    ['bracket', 'a[0]'],
    ['backslash', 'a\\b'],
    ['control', 'a\x01b'],
    ['newline', 'a\nb'],
    ['DEL', 'a\x7fb'],
    ['too long', 'a'.repeat(256)],
  ])('rejects %s', (_n, s) => {
    expect(isSafeRefName(s)).toBe(false);
  });
  it('rejects non-strings and accepts 255 chars', () => {
    expect(isSafeRefName(undefined)).toBe(false);
    expect(isSafeRefName(5)).toBe(false);
    expect(isSafeRefName('a'.repeat(255))).toBe(true);
  });
});

const q = { branch: { kind: 'current' }, skip: 0, pageSize: 50 };

describe('validateRequest', () => {
  it('drops junk, unknown types, bad ids', () => {
    expect(validateRequest(null)).toBeUndefined();
    expect(validateRequest('x')).toBeUndefined();
    expect(validateRequest({ id: 1, type: 'nope' })).toBeUndefined();
    expect(validateRequest({ id: 1.5, type: 'refs' })).toBeUndefined();
    expect(validateRequest({ type: 'refs' })).toBeUndefined();
  });
  it('accepts simple variants', () => {
    expect(validateRequest({ id: 1, type: 'refs' })).toEqual({ id: 1, type: 'refs' });
    expect(validateRequest({ id: 2, type: 'authors' })).toEqual({ id: 2, type: 'authors' });
    expect(validateRequest({ id: 3, type: 'compareRefs' })).toEqual({ id: 3, type: 'compareRefs' });
    expect(validateRequest({ id: 4, type: 'details', hash: 'abcd1234' })).toEqual({
      id: 4,
      type: 'details',
      hash: 'abcd1234',
    });
    expect(validateRequest({ id: 5, type: 'selectForComparison', hash: 'abcd' })).toBeDefined();
    expect(validateRequest({ id: 6, type: 'compareWithSelected', hash: 'abcd' })).toBeDefined();
  });
  it('validates openVersionDiff', () => {
    expect(validateRequest({ id: 3, type: 'openVersionDiff', hash: 'abcd1234' })).toEqual({
      id: 3,
      type: 'openVersionDiff',
      hash: 'abcd1234',
    });
    expect(validateRequest({ id: 3, type: 'openVersionDiff', hash: '--all' })).toBeUndefined();
  });

  it('validates fetch, me, head and openExternal (http and https only)', () => {
    for (const type of ['fetch', 'me', 'head'] as const)
      expect(validateRequest({ id: 1, type, extra: 1 })).toEqual({ id: 1, type });
    expect(
      validateRequest({ id: 2, type: 'openExternal', url: 'https://jira.example.com/browse/A-1' }),
    ).toEqual({
      id: 2,
      type: 'openExternal',
      url: 'https://jira.example.com/browse/A-1',
    });
    for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'command:workbench.action.quit', 'x', 7])
      expect(validateRequest({ id: 3, type: 'openExternal', url })).toBeUndefined();
    expect(
      validateRequest({ id: 3, type: 'openExternal', url: `https://x/${'a'.repeat(2048)}` }),
    ).toBeUndefined();
  });

  it('validates saveLayout: keeps the well-formed fields and drops the rest', () => {
    expect(
      validateRequest({
        id: 1,
        type: 'saveLayout',
        layout: {
          panelWidth: 240,
          columns: { author: 40, date: 400, hash: 39, x: 100 },
          fileTree: true,
          y: 1,
        },
      }),
    ).toEqual({
      id: 1,
      type: 'saveLayout',
      layout: { panelWidth: 240, columns: { author: 40, date: 400 }, fileTree: true },
    });
    expect(validateRequest({ id: 1, type: 'saveLayout', layout: { panelWidth: 601 } })).toBeUndefined();
    for (const layout of [
      undefined,
      'wide',
      {},
      { panelWidth: 300.5 },
      { columns: { author: '100' } },
      { fileTree: 'yes' },
    ])
      expect(validateRequest({ id: 1, type: 'saveLayout', layout })).toBeUndefined();
  });

  it('validates openDiff pinned: a boolean, kept only when true', () => {
    const file = { status: 'M', path: 'a.txt' };
    expect(validateRequest({ id: 1, type: 'openDiff', hash: 'abcd1234', file, pinned: true })).toEqual({
      id: 1,
      type: 'openDiff',
      hash: 'abcd1234',
      file,
      pinned: true,
    });
    expect(validateRequest({ id: 1, type: 'openDiff', hash: 'abcd1234', file, pinned: false })).toEqual({
      id: 1,
      type: 'openDiff',
      hash: 'abcd1234',
      file,
    });
    expect(
      validateRequest({ id: 1, type: 'openDiff', hash: 'abcd1234', file, pinned: 'yes' }),
    ).toBeUndefined();
  });

  it('validates details: a hash and, for the uncommitted changes, an optional path', () => {
    expect(validateRequest({ id: 1, type: 'details', hash: 'abcd1234', path: 'docs' })).toEqual({
      id: 1,
      type: 'details',
      hash: 'abcd1234',
      path: 'docs',
    });
    expect(validateRequest({ id: 1, type: 'details', hash: 'abcd1234' })).toEqual({
      id: 1,
      type: 'details',
      hash: 'abcd1234',
    });
    expect(validateRequest({ id: 1, type: 'details', hash: 'abcd1234', path: 7 })).toBeUndefined();
    expect(validateRequest({ id: 1, type: 'details', hash: 'abcd1234', path: 'a\0b' })).toBeUndefined();
  });

  it('validates containing: a hash only', () => {
    expect(validateRequest({ id: 1, type: 'containing', hash: 'abcd1234' })).toEqual({
      id: 1,
      type: 'containing',
      hash: 'abcd1234',
    });
    for (const hash of ['HEAD', '--all', 'main', undefined])
      expect(validateRequest({ id: 1, type: 'containing', hash })).toBeUndefined();
  });

  it('validates refreshRepo and showInCommitView', () => {
    expect(validateRequest({ id: 7, type: 'refreshRepo' })).toEqual({ id: 7, type: 'refreshRepo' });
    expect(validateRequest({ id: 8, type: 'showInCommitView', hash: 'abcd1234' })).toEqual({
      id: 8,
      type: 'showInCommitView',
      hash: 'abcd1234',
    });
    expect(validateRequest({ id: 9, type: 'showInCommitView', hash: 'HEAD' })).toBeUndefined();
    expect(validateRequest({ id: 9, type: 'showInCommitView', hash: '--all' })).toBeUndefined();
    expect(validateRequest({ id: 9, type: 'showInCommitView' })).toBeUndefined();
  });
  it('drops details with a non-hash', () => {
    expect(validateRequest({ id: 1, type: 'details', hash: 'HEAD' })).toBeUndefined();
    expect(validateRequest({ id: 1, type: 'details', hash: '--output=x' })).toBeUndefined();
  });
  it('validates action', () => {
    expect(validateRequest({ id: 1, type: 'action', action: 'checkout', hash: 'abcd' })).toBeDefined();
    expect(
      validateRequest({ id: 1, type: 'action', action: 'createBranch', hash: 'abcd', ref: 'feat/x' }),
    ).toBeDefined();
    expect(
      validateRequest({ id: 1, type: 'action', action: 'checkout', hash: 'abcd', ref: '--force' }),
    ).toBeUndefined();
    expect(validateRequest({ id: 1, type: 'action', action: 'rm-rf', hash: 'abcd' })).toBeUndefined();
    expect(validateRequest({ id: 1, type: 'action', hash: 'abcd' })).toBeUndefined();
  });
  it('validates path requests', () => {
    expect(validateRequest({ id: 1, type: 'openFileAt', hash: 'abcd', path: 'src/a.ts' })).toBeDefined();
    expect(validateRequest({ id: 1, type: 'openFileAt', hash: 'abcd', path: '' })).toBeUndefined();
    expect(
      validateRequest({ id: 1, type: 'compareWithWorkspace', hash: 'abcd', path: 'a\0b' }),
    ).toBeUndefined();
    expect(validateRequest({ id: 1, type: 'compareWithWorkspace', hash: 'abcd', path: 'a' })).toBeDefined();
  });
  it.each([
    '/etc/passwd',
    '../outside.txt',
    'a/../../b',
    'a/..',
    '..',
    '\\\\host\\share',
    'C:\\x',
    'c:/x',
    'a\\..\\..\\b',
  ])('rejects the absolute or escaping path %j in path requests', (path) => {
    for (const type of ['openFileAt', 'compareWithWorkspace'])
      expect(validateRequest({ id: 1, type, hash: 'abcd', path })).toBeUndefined();
    const file = (f: object) => validateRequest({ id: 1, type: 'openDiff', hash: 'abcd', file: f });
    expect(file({ status: 'M', path })).toBeUndefined();
    expect(file({ status: 'R', path: 'ok.txt', oldPath: path })).toBeUndefined();
  });
  it.each(['a..b.txt', '..hidden', 'dir/..x/y', 'x..'])('keeps the repo-relative path %j', (path) => {
    expect(validateRequest({ id: 1, type: 'compareWithWorkspace', hash: 'abcd', path })).toBeDefined();
  });
  it('validates openDiff file', () => {
    const ok = {
      id: 1,
      type: 'openDiff',
      hash: 'abcd',
      file: { status: 'R', path: 'b', oldPath: 'a', additions: 1, deletions: 0, binary: false },
    };
    expect(validateRequest(ok)).toEqual(ok);
    const bad = (file: unknown) => validateRequest({ id: 1, type: 'openDiff', hash: 'abcd', file });
    expect(bad({ status: 'X', path: 'a' })).toBeUndefined();
    expect(bad({ status: 'M', path: '' })).toBeUndefined();
    expect(bad({ status: 'M', path: 'a\0' })).toBeUndefined();
    expect(bad({ status: 'M', path: 'a', oldPath: '' })).toBeUndefined();
    expect(bad({ status: 'M', path: 'a', oldPath: 'x\0' })).toBeUndefined();
    expect(bad({ status: 'M', path: 'a', additions: -1 })).toBeUndefined();
    expect(bad({ status: 'M', path: 'a', deletions: 'x' })).toBeUndefined();
    expect(bad({ status: 'M', path: 'a', binary: 'yes' })).toBeUndefined();
    expect(bad(null)).toBeUndefined();
    expect(
      validateRequest({ id: 1, type: 'openDiff', hash: 'HEAD', file: { status: 'M', path: 'a' } }),
    ).toBeUndefined();
  });
  it('validates copy and avatars', () => {
    expect(validateRequest({ id: 1, type: 'copy', text: 'x'.repeat(10000) })).toBeDefined();
    expect(validateRequest({ id: 1, type: 'copy', text: 'x'.repeat(10001) })).toBeUndefined();
    expect(validateRequest({ id: 1, type: 'copy', text: 5 })).toBeUndefined();
    expect(validateRequest({ id: 1, type: 'avatars', emails: ['a@b.c'] })).toBeDefined();
    expect(validateRequest({ id: 1, type: 'avatars', emails: Array(201).fill('a@b.c') })).toBeUndefined();
    expect(validateRequest({ id: 1, type: 'avatars', emails: ['a'.repeat(255)] })).toBeUndefined();
    expect(validateRequest({ id: 1, type: 'avatars', emails: [1] })).toBeUndefined();
  });
  it('validates log query', () => {
    const log = (query: unknown) => validateRequest({ id: 1, type: 'log', query });
    expect(log(q)).toEqual({ id: 1, type: 'log', query: q });
    expect(log({ ...q, pageSize: 1e9 })).toBeUndefined();
    expect(log({ ...q, pageSize: 0 })).toBeUndefined();
    expect(log({ ...q, pageSize: 1000 })).toBeDefined();
    expect(log({ ...q, skip: -1 })).toBeUndefined();
    expect(log({ ...q, skip: 1.5 })).toBeUndefined();
    expect(log({ ...q, extra: 1 })).toBeUndefined();
    expect(log({ ...q, branch: { kind: 'all' } })).toBeDefined();
    expect(log({ ...q, branch: { kind: 'ref', ref: 'main' } })).toBeDefined();
    expect(log({ ...q, branch: { kind: 'ref', ref: '--all' } })).toBeUndefined();
    expect(log({ ...q, branch: { kind: 'ref' } })).toBeUndefined();
    expect(log({ ...q, branch: { kind: 'other' } })).toBeUndefined();
    expect(log({ ...q, branch: undefined })).toBeUndefined();
    expect(log({ ...q, text: 'x'.repeat(1000) })).toBeDefined();
    expect(log({ ...q, text: 'x'.repeat(1001) })).toBeUndefined();
    expect(log({ ...q, author: 'a\0' })).toBeUndefined();
    expect(log({ ...q, path: 5 })).toBeUndefined();
    expect(log({ ...q, since: '2020-01-01', until: '2021-01-01' })).toBeDefined();
    expect(log({ ...q, follow: 'true' })).toBeUndefined();
    expect(log({ ...q, follow: true })).toBeDefined();
    expect(log({ ...q, maxCount: 0 })).toBeDefined();
    expect(log({ ...q, maxCount: -1 })).toBeUndefined();
    expect(log({ ...q, lines: { path: 'a', start: 1, end: 3 } })).toBeDefined();
    expect(log({ ...q, lines: { path: 'a', start: 0, end: 3 } })).toBeUndefined();
    expect(log({ ...q, lines: { path: 'a', start: 4, end: 3 } })).toBeUndefined();
    expect(log({ ...q, lines: { path: '', start: 1, end: 3 } })).toBeUndefined();
    expect(log({ ...q, lines: { path: 'a', start: 1, end: 3, x: 1 } })).toBeUndefined();
    expect(log(null)).toBeUndefined();
  });
  it('validates the log count', () => {
    const log = (count: unknown) => validateRequest({ id: 1, type: 'log', query: q, count });
    expect(log(undefined)).toEqual({ id: 1, type: 'log', query: q });
    expect(log(1)).toEqual({ id: 1, type: 'log', query: q, count: 1 });
    expect(log(LOG_COUNT_MAX)).toEqual({ id: 1, type: 'log', query: q, count: LOG_COUNT_MAX });
    expect(log(LOG_COUNT_MAX + 1)).toBeUndefined();
    expect(log(0)).toBeUndefined();
    expect(log(2.5)).toBeUndefined();
    expect(log('10')).toBeUndefined();
  });
  it('rejects a __proto__ key in a JSON-parsed query', () => {
    const msg = JSON.parse(
      '{"id":1,"type":"log","query":{"__proto__":{"x":1},"branch":{"kind":"current"},"skip":0,"pageSize":10}}',
    );
    expect(validateRequest(msg)).toBeUndefined();
  });
  it('validates graphCarry', () => {
    const log = (graphCarry: unknown) => validateRequest({ id: 1, type: 'log', query: { ...q, graphCarry } });
    expect(log({ lanes: ['abcd', null], colors: [0, 1], nextColor: 2 })).toBeDefined();
    expect(log({ lanes: ['ABCD'], colors: [0], nextColor: 1 })).toBeUndefined();
    expect(log({ lanes: ['abcd'], colors: [0, 1], nextColor: 1 })).toBeUndefined();
    expect(log({ lanes: ['abcd'], colors: [-1], nextColor: 1 })).toBeUndefined();
    expect(log({ lanes: ['abcd'], colors: [0], nextColor: -1 })).toBeUndefined();
    expect(log({ lanes: Array(1001).fill(null), colors: Array(1001).fill(0), nextColor: 0 })).toBeUndefined();
    expect(log({ lanes: Array(1000).fill(null), colors: Array(1000).fill(0), nextColor: 0 })).toBeDefined();
    expect(log({ lanes: [], colors: [], nextColor: 0, z: 1 })).toBeUndefined();
    expect(log('x')).toBeUndefined();
  });
  it('returns a fresh object, immune to later mutation', () => {
    const input = {
      id: 1,
      type: 'log',
      query: {
        branch: { kind: 'ref', ref: 'main' },
        skip: 0,
        pageSize: 10,
        graphCarry: { lanes: ['abcd'], colors: [0], nextColor: 1 },
      },
    };
    const out = validateRequest(input) as unknown as {
      query: { branch: { ref: string }; graphCarry: { lanes: string[] } };
    };
    expect(out).not.toBe(input);
    expect(out.query).not.toBe(input.query);
    expect(out.query.branch).not.toBe(input.query.branch);
    expect(out.query.graphCarry.lanes).not.toBe(input.query.graphCarry.lanes);
    input.query.branch.ref = '--evil';
    input.query.graphCarry.lanes[0] = '--evil';
    expect(out.query.branch.ref).toBe('main');
    expect(out.query.graphCarry.lanes[0]).toBe('abcd');
  });
  it('ignores unknown top-level keys on the message', () => {
    expect(validateRequest({ id: 1, type: 'refs', junk: 1 })).toEqual({ id: 1, type: 'refs' });
  });
});
