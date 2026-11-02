import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import {
  GitFileSystemProvider,
  fromGitUri,
  registerGitFileSystem,
  toGitUri,
} from '../../src/content/gitContentProvider';
import type { RepoLocator } from '../../src/git/repoLocator';

const H = 'a'.repeat(40);

/** A locator that only knows the repository at `/r`. */
function locatorFor(show: (ref: string, p: string) => Promise<Buffer>): RepoLocator {
  return {
    knownService: async (root: string) => (root === '/r' ? { root, show } : undefined),
  } as unknown as RepoLocator;
}

describe('toGitUri / fromGitUri', () => {
  it('uses the git-history-plus scheme and a leading-slash path', () => {
    const u = toGitUri('/r', 'src/a.ts', H);
    expect(u.scheme).toBe('git-history-plus');
    expect(u.path).toBe('/src/a.ts');
  });
  it('round-trips root and path with spaces, # and ?', () => {
    const root = '/my repo/with #hash?';
    const p = 'dir one/we#ird?.txt';
    const u = toGitUri(root, p, H);
    expect(fromGitUri(u)).toEqual({ root, path: p, ref: H });
    expect(fromGitUri(vscode.Uri.parse(u.toString()))).toEqual({ root, path: p, ref: H });
  });
  it('round-trips EMPTY', () => {
    expect(fromGitUri(toGitUri('/r', 'x', 'EMPTY')).ref).toBe('EMPTY');
  });
});

const text = (b: Uint8Array) => Buffer.from(b).toString('utf8');

describe('GitFileSystemProvider', () => {
  it('returns the file bytes at the commit', async () => {
    const calls: string[][] = [];
    const fs = new GitFileSystemProvider(
      locatorFor(async (ref, p) => {
        calls.push([ref, p]);
        return Buffer.from('héllo\n');
      }),
    );
    expect(text(await fs.readFile(toGitUri('/r', 'a b.txt', H)))).toBe('héllo\n');
    expect(calls).toEqual([[H, 'a b.txt']]);
  });
  it('returns no bytes for EMPTY without touching git', async () => {
    const fs = new GitFileSystemProvider(
      locatorFor(async () => {
        throw new Error('should not be called');
      }),
    );
    expect((await fs.readFile(toGitUri('/r', 'a.txt', 'EMPTY'))).length).toBe(0);
  });
  it('returns binary content unchanged so the editor can preview it', async () => {
    const fs = new GitFileSystemProvider(locatorFor(async () => Buffer.from([0x50, 0x4e, 0x00, 0x47])));
    expect([...(await fs.readFile(toGitUri('/r', 'a.png', H)))]).toEqual([0x50, 0x4e, 0x00, 0x47]);
  });
  it('stats a version as a read-only file of its real size, reading git once', async () => {
    let n = 0;
    const fs = new GitFileSystemProvider(
      locatorFor(async () => {
        n++;
        return Buffer.from('12345');
      }),
    );
    const u = toGitUri('/r', 'a.txt', H);
    const st = await fs.stat(u);
    expect(st.type).toBe(vscode.FileType.File);
    expect(st.size).toBe(5);
    expect(st.permissions).toBe(vscode.FilePermission.Readonly);
    await fs.readFile(u);
    expect(n).toBe(1);
  });
  it('refuses every write', () => {
    const fs: vscode.FileSystemProvider = new GitFileSystemProvider(locatorFor(async () => Buffer.from('')));
    const u = toGitUri('/r', 'a.txt', H);
    expect(() => fs.writeFile(u, new Uint8Array(), { create: true, overwrite: true })).toThrow();
    expect(() => fs.delete(u, { recursive: false })).toThrow();
    expect(() => fs.rename(u, u, { overwrite: false })).toThrow();
    expect(() => fs.createDirectory(u)).toThrow();
  });
  it('is registered read-only with an explanation', () => {
    const spy = vi.spyOn(vscode.workspace, 'registerFileSystemProvider');
    registerGitFileSystem(locatorFor(async () => Buffer.from('')));
    const [scheme, , opts] = spy.mock.calls[0]!;
    expect(scheme).toBe('git-history-plus');
    expect((opts as { isReadonly: vscode.MarkdownString }).isReadonly.value).toMatch(/can.t be edited/);
    spy.mockRestore();
  });
});

describe('GitFileSystemProvider hardening (option injection)', () => {
  const never = locatorFor(async () => {
    throw new Error('git must not run');
  });
  const uriWith = (query: object, path = '/a.txt') =>
    vscode.Uri.from({ scheme: 'git-history-plus', path, query: JSON.stringify(query) });

  it.each(['--output=x', '-p', 'HEAD', 'main', 'a'.repeat(3), `${H}:x`])(
    'refuses and runs no git for ref %j',
    async (ref) => {
      const fs = new GitFileSystemProvider(never);
      await expect(fs.readFile(uriWith({ root: '/r', ref }))).rejects.toThrow();
    },
  );
  it('refuses and runs no git for a root the locator does not know', async () => {
    const fs = new GitFileSystemProvider(never);
    await expect(fs.readFile(toGitUri('/somewhere/else', 'a.txt', H))).rejects.toThrow();
  });
  it('refuses a malformed query', async () => {
    const fs = new GitFileSystemProvider(never);
    const u = vscode.Uri.from({ scheme: 'git-history-plus', path: '/a.txt', query: '{nope' });
    await expect(fs.readFile(u)).rejects.toThrow();
  });
});
