import * as vscode from 'vscode';
import { SCHEME } from '../constants';
import type { RepoLocator } from '../git/repoLocator';
import { logger } from '../logger';
import { isHash } from '../shared/validate';
import type { Hash } from '../shared/types';

export type GitRef = Hash | 'EMPTY';

export function toGitUri(root: string, path: string, ref: GitRef): vscode.Uri {
  const rel = path.replace(/\\/g, '/').replace(/^\/+/, '');
  return vscode.Uri.from({ scheme: SCHEME, path: '/' + rel, query: JSON.stringify({ root, ref }) });
}

export function fromGitUri(uri: vscode.Uri): { root: string; path: string; ref: GitRef } {
  const { root, ref } = JSON.parse(uri.query) as { root: string; ref: GitRef };
  return { root, path: uri.path.replace(/^\//, ''), ref };
}

/** Versions are immutable per hash, so a small cache lets stat() and readFile() share one git call. */
const CACHE_LIMIT = 50;

/** Parses and checks a content URI; anything not produced by toGitUri for a known repo is refused. */
function parseGitUri(uri: vscode.Uri): { root: string; path: string; ref: GitRef } | undefined {
  let parsed: { root: unknown; path: string; ref: unknown };
  try {
    parsed = fromGitUri(uri);
  } catch {
    return undefined;
  }
  const { root, path, ref } = parsed;
  if (typeof root !== 'string' || root === '') return undefined;
  if (ref !== 'EMPTY' && !isHash(ref)) return undefined;
  return { root, path, ref };
}

/**
 * Serves past versions as a read-only file system. A TextDocumentContentProvider is read-only in
 * VS Code but editable in Theia (its resource has no readOnly flag), so a read-only provider is
 * the one mechanism both hosts honour.
 */
export class GitFileSystemProvider implements vscode.FileSystemProvider {
  private readonly cache = new Map<string, Promise<Uint8Array>>();
  private readonly changes = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this.changes.event;

  constructor(private readonly locator: Pick<RepoLocator, 'knownService'>) {}

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const bytes = await this.readFile(uri);
    return {
      type: vscode.FileType.File,
      ctime: 0,
      mtime: 0,
      size: bytes.length,
      permissions: vscode.FilePermission.Readonly,
    };
  }

  readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const key = uri.toString();
    let bytes = this.cache.get(key);
    if (!bytes) {
      bytes = this.load(uri);
      bytes.catch(() => this.cache.delete(key));
      this.cache.set(key, bytes);
      if (this.cache.size > CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value!);
    }
    return bytes;
  }

  private async load(uri: vscode.Uri): Promise<Uint8Array> {
    // The URI is attacker-controllable (any extension or link can open it): only a hash or EMPTY may
    // reach git, and only in a repository this extension already knows.
    const parsed = parseGitUri(uri);
    if (parsed?.ref === 'EMPTY') return new Uint8Array();
    const svc = parsed && (await this.locator.knownService(parsed.root));
    if (!parsed || !svc) {
      logger.warn(`Refused a ${SCHEME} URI with an invalid revision or an unknown repository`);
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    return svc.show(parsed.ref, parsed.path);
  }

  watch(): vscode.Disposable {
    return { dispose: () => undefined };
  }

  readDirectory(uri: vscode.Uri): never {
    throw vscode.FileSystemError.FileNotFound(uri);
  }

  createDirectory(uri: vscode.Uri): never {
    throw vscode.FileSystemError.NoPermissions(uri);
  }

  writeFile(uri: vscode.Uri): never {
    throw vscode.FileSystemError.NoPermissions(uri);
  }

  delete(uri: vscode.Uri): never {
    throw vscode.FileSystemError.NoPermissions(uri);
  }

  rename(uri: vscode.Uri): never {
    throw vscode.FileSystemError.NoPermissions(uri);
  }
}

export function registerGitFileSystem(locator: Pick<RepoLocator, 'knownService'>): vscode.Disposable {
  return vscode.workspace.registerFileSystemProvider(SCHEME, new GitFileSystemProvider(locator), {
    isCaseSensitive: true,
    isReadonly: new vscode.MarkdownString("This is a past version from git history and can't be edited."),
  });
}
