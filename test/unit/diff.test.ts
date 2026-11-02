import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { compareFiles, compareWithWorkspace, openDiff, openFileAt } from '../../src/diff';
import { fromGitUri } from '../../src/content/gitContentProvider';
import type { GitService } from '../../src/git/gitService';

const svc = { root: '/repo' } as unknown as GitService;
const P = 'p'.repeat(40);
const C = 'c'.repeat(40);
let spy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  spy = vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined);
});

const call = () => spy.mock.calls[0] as [string, vscode.Uri, vscode.Uri, string, unknown];

describe('openDiff', () => {
  it('M: same path both sides, titled with short hashes', async () => {
    await openDiff(svc, C, P, { status: 'M', path: 'src/a.ts' });
    const [cmd, l, r, title, opts] = call();
    expect(cmd).toBe('vscode.diff');
    expect(fromGitUri(l)).toEqual({ root: '/repo', path: 'src/a.ts', ref: P });
    expect(fromGitUri(r)).toEqual({ root: '/repo', path: 'src/a.ts', ref: C });
    expect(title).toBe('a.ts (ppppppp ↔ ccccccc)');
    expect(opts).toEqual({ preview: true });
  });
  it('A: left is EMPTY', async () => {
    await openDiff(svc, C, P, { status: 'A', path: 'n.txt' });
    const [, l, r] = call();
    expect(fromGitUri(l).ref).toBe('EMPTY');
    expect(fromGitUri(r)).toEqual({ root: '/repo', path: 'n.txt', ref: C });
  });
  it('D: right is EMPTY', async () => {
    await openDiff(svc, C, P, { status: 'D', path: 'gone.txt' });
    const [, l, r] = call();
    expect(fromGitUri(l)).toEqual({ root: '/repo', path: 'gone.txt', ref: P });
    expect(fromGitUri(r).ref).toBe('EMPTY');
  });
  it('R: left uses oldPath', async () => {
    await openDiff(svc, C, P, { status: 'R', path: 'new/b.ts', oldPath: 'old/b.ts' });
    const [, l, r] = call();
    expect(fromGitUri(l)).toEqual({ root: '/repo', path: 'old/b.ts', ref: P });
    expect(fromGitUri(r)).toEqual({ root: '/repo', path: 'new/b.ts', ref: C });
  });
  it('root commit (no parent): left is EMPTY', async () => {
    await openDiff(svc, C, undefined, { status: 'M', path: 'a.ts' });
    const [, l, , title] = call();
    expect(fromGitUri(l).ref).toBe('EMPTY');
    expect(title).toBe('a.ts (empty ↔ ccccccc)');
  });
});

describe('compareFiles / compareWithWorkspace / openFileAt', () => {
  it('compareFiles diffs two commits', async () => {
    await compareFiles(svc, P, C, { status: 'R', path: 'n.ts', oldPath: 'o.ts' });
    const [, l, r, title] = call();
    expect(fromGitUri(l)).toEqual({ root: '/repo', path: 'o.ts', ref: P });
    expect(fromGitUri(r)).toEqual({ root: '/repo', path: 'n.ts', ref: C });
    expect(title).toBe('n.ts (ppppppp ↔ ccccccc)');
  });
  it('compareFiles A: left is EMPTY', async () => {
    await compareFiles(svc, P, C, { status: 'A', path: 'n.txt' });
    const [, l, r] = call();
    expect(fromGitUri(l).ref).toBe('EMPTY');
    expect(fromGitUri(r)).toEqual({ root: '/repo', path: 'n.txt', ref: C });
  });
  it('compareFiles D: right is EMPTY', async () => {
    await compareFiles(svc, P, C, { status: 'D', path: 'gone.txt' });
    const [, l, r] = call();
    expect(fromGitUri(l)).toEqual({ root: '/repo', path: 'gone.txt', ref: P });
    expect(fromGitUri(r).ref).toBe('EMPTY');
  });
  it('compareWithWorkspace: right is the workspace file', async () => {
    await compareWithWorkspace(svc, C, 'src/a.ts');
    const [cmd, l, r, title] = call();
    expect(cmd).toBe('vscode.diff');
    expect(fromGitUri(l)).toEqual({ root: '/repo', path: 'src/a.ts', ref: C });
    expect(r.scheme).toBe('file');
    expect(r.fsPath).toBe('/repo/src/a.ts');
    expect(title).toBe('a.ts (ccccccc ↔ workspace)');
  });
  it('compareWithWorkspace refuses a path that resolves outside the repository', async () => {
    await expect(compareWithWorkspace(svc, C, '../etc/passwd')).rejects.toThrow(/outside the repository/);
    await expect(compareWithWorkspace(svc, C, '/etc/passwd')).rejects.toThrow(/outside the repository/);
    expect(spy).not.toHaveBeenCalled();
  });
  it('compareWithWorkspace accepts a file whose name merely starts with two dots', async () => {
    await compareWithWorkspace(svc, C, '..hidden');
    expect((call()[2] as vscode.Uri).fsPath).toBe('/repo/..hidden');
  });
  it('openFileAt opens the commit version via vscode.open', async () => {
    await openFileAt(svc, C, 'src/a.ts');
    const [cmd, u] = spy.mock.calls[0] as [string, vscode.Uri];
    expect(cmd).toBe('vscode.open');
    expect(fromGitUri(u)).toEqual({ root: '/repo', path: 'src/a.ts', ref: C });
  });
});
