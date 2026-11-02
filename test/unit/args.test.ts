import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { normalizeUriArg } from '../../src/args';

const a = vscode.Uri.file('/tmp/a');
const b = vscode.Uri.file('/tmp/b');

describe('normalizeUriArg', () => {
  it('accepts a bare Uri (Theia file explorer)', () => expect(normalizeUriArg(a)).toBe(a));
  it('accepts { resourceUri }', () => expect(normalizeUriArg({ resourceUri: a })).toBe(a));
  it('accepts an SCM resource state', () =>
    expect(normalizeUriArg({ resourceUri: a, decorations: {}, command: undefined })).toBe(a));
  it('accepts a SourceControl { rootUri } (scm/title button)', () =>
    expect(normalizeUriArg({ id: 'git', label: 'Git', rootUri: a })).toBe(a));
  it('takes the first of a Uri[]', () => expect(normalizeUriArg([a, b])).toBe(a));
  it('takes the first of a [Uri, Uri[]] explorer multi-select', () =>
    expect(normalizeUriArg([a, [a, b]])).toBe(a));
  it('takes the first of a resource-state array', () =>
    expect(normalizeUriArg([{ resourceUri: b }])).toBe(b));
  it('returns undefined for undefined and junk', () => {
    expect(normalizeUriArg(undefined)).toBeUndefined();
    expect(normalizeUriArg(null)).toBeUndefined();
    expect(normalizeUriArg([])).toBeUndefined();
    expect(normalizeUriArg('x')).toBeUndefined();
    expect(normalizeUriArg({})).toBeUndefined();
  });
});
