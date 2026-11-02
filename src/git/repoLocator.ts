import { realpathSync as realpathSyncNative } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { GitError, resolveGitPath, runGit } from './exec';
import { GitService } from './gitService';

export interface GitApiLike {
  git: { path: string };
  repositories: { rootUri: vscode.Uri }[];
  onDidOpenRepository: vscode.Event<unknown>;
  onDidCloseRepository: vscode.Event<unknown>;
}

const isWindows = process.platform === 'win32';
const cmpKey = (p: string): string => (isWindows ? p.toLowerCase() : p);

function contains(root: string, p: string): boolean {
  const r = cmpKey(root);
  const c = cmpKey(p);
  if (c === r) return true;
  return c.startsWith(r.endsWith(path.sep) ? r : r + path.sep);
}

async function realpathOrUndefined(p: string): Promise<string | undefined> {
  try {
    return await fs.realpath(p);
  } catch {
    return undefined;
  }
}

/** realpath that tolerates a missing tail: resolves the nearest existing ancestor and re-appends the rest. */
export async function realpathLenient(p: string): Promise<string | undefined> {
  const real = await realpathOrUndefined(p);
  if (real) return real;
  const parent = path.dirname(p);
  if (parent === p) return undefined;
  const base = await realpathLenient(parent);
  return base === undefined ? undefined : path.join(base, path.basename(p));
}

/**
 * The repo-relative path of `uri`. svc.root is a realpath, so the target is realpath'd the same way
 * RepoLocator.resolveUri does; otherwise a symlinked folder yields "../link/a.txt" (#786).
 */
export async function relPath(svc: GitService, uri: vscode.Uri): Promise<string> {
  const real = (await realpathLenient(uri.fsPath)) ?? uri.fsPath;
  return path.relative(svc.root, real).split(path.sep).join('/');
}

export class RepoLocator implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeRepositories: vscode.Event<void> = this.emitter.event;
  private readonly services = new Map<string, GitService>();
  private readonly subscriptions: vscode.Disposable[] = [];
  private subscribedApi: GitApiLike | undefined;

  constructor(private readonly gitPathSetting: () => string | null) {
    this.subscribe();
    this.subscriptions.push(vscode.extensions.onDidChange(() => void this.ensureApi()));
  }

  /** Activates vscode.git when present but not yet active, subscribes once, and returns its API. */
  async ensureApi(): Promise<GitApiLike | undefined> {
    try {
      const ext = vscode.extensions.getExtension('vscode.git');
      if (ext && !ext.isActive) await ext.activate();
    } catch {
      /* disabled or failed to activate: treat as absent */
    }
    this.subscribe();
    return this.gitApi();
  }

  private gitApi(): GitApiLike | undefined {
    try {
      const api = vscode.extensions.getExtension('vscode.git')?.exports?.getAPI(1) as GitApiLike | undefined;
      return api ?? undefined;
    } catch {
      return undefined;
    }
  }

  private subscribe(): void {
    const api = this.gitApi();
    if (!api || api === this.subscribedApi) return;
    this.subscribedApi = api;
    this.subscriptions.push(
      api.onDidOpenRepository(() => this.emitter.fire()),
      api.onDidCloseRepository(() => this.emitter.fire()),
    );
  }

  gitPath(): string {
    return resolveGitPath(this.gitApi()?.git?.path, this.gitPathSetting());
  }

  service(root: string): GitService {
    const real = this.realpathSync(root);
    const key = cmpKey(real);
    let svc = this.services.get(key);
    if (!svc) {
      svc = new GitService(real, this.gitPath());
      this.services.set(key, svc);
    }
    return svc;
  }

  /**
   * The service for `root` only when it is a repository this locator already serves or vscode.git has
   * open; never creates one for an arbitrary path (content URIs carry the root as untrusted data).
   */
  async knownService(root: string): Promise<GitService | undefined> {
    const hit = this.services.get(cmpKey(root));
    if (hit) return hit;
    const real = await realpathOrUndefined(root);
    if (!real) return undefined;
    const cached = this.services.get(cmpKey(real));
    if (cached) return cached;
    for (const repo of this.gitApi()?.repositories ?? []) {
      const r = await realpathOrUndefined(repo.rootUri.fsPath);
      if (r && cmpKey(r) === cmpKey(real)) return this.service(r);
    }
    return undefined;
  }

  private realpathSync(p: string): string {
    try {
      return realpathSyncNative(p);
    } catch {
      return p;
    }
  }

  async repoFor(uri?: vscode.Uri): Promise<GitService | undefined> {
    await this.ensureApi();
    const target = uri ?? vscode.window.activeTextEditor?.document.uri;
    if (target) return this.resolveUri(target);
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const svc = await this.resolveUri(folder.uri);
      if (svc) return svc;
    }
    return undefined;
  }

  private async resolveUri(uri: vscode.Uri): Promise<GitService | undefined> {
    const real = await realpathLenient(uri.fsPath);
    if (!real) return undefined;
    let best: string | undefined;
    for (const repo of this.gitApi()?.repositories ?? []) {
      const root = await realpathOrUndefined(repo.rootUri.fsPath);
      if (root && contains(root, real) && (!best || root.length > best.length)) best = root;
    }
    if (best) return this.service(best);
    const top = await this.revParseToplevel(real);
    return top ? this.service(top) : undefined;
  }

  private async revParseToplevel(real: string): Promise<string | undefined> {
    let dir = real;
    for (;;) {
      try {
        if ((await fs.stat(dir)).isDirectory()) break;
      } catch {
        /* missing: try the parent */
      }
      const parent = path.dirname(dir);
      if (parent === dir) return undefined;
      dir = parent;
    }
    try {
      const out = await runGit(this.gitPath(), dir, ['rev-parse', '--show-toplevel']);
      return await realpathOrUndefined(out.replace(/\r?\n$/, ''));
    } catch (e) {
      if (e instanceof GitError && e.exitCode === 128) return undefined;
      throw e;
    }
  }

  /**
   * The repository to use when no file points at one: the only candidate, or the user's pick.
   * Resolves `undefined` when there is no repository and 'cancelled' when the pick was dismissed.
   */
  async pickRepo(alwaysPrompt: boolean): Promise<GitService | 'cancelled' | undefined> {
    await this.ensureApi();
    const roots = await this.candidateRoots();
    const [only] = roots;
    if (only === undefined) return undefined;
    if (roots.length === 1 && !alwaysPrompt) return this.service(only);
    const picked = await vscode.window.showQuickPick(
      roots.map((r) => ({ label: path.basename(r), description: r })),
      { placeHolder: 'Select a git repository' },
    );
    return picked ? this.service((picked as { description: string }).description) : 'cancelled';
  }

  private async candidateRoots(): Promise<string[]> {
    const seen = new Map<string, string>();
    const add = (root: string) => {
      const k = cmpKey(root);
      if (!seen.has(k)) seen.set(k, root);
    };
    const apiRepos = this.gitApi()?.repositories ?? [];
    if (apiRepos.length > 0) {
      for (const r of apiRepos) {
        const real = await realpathOrUndefined(r.rootUri.fsPath);
        if (real) add(real);
      }
    } else {
      for (const f of vscode.workspace.workspaceFolders ?? []) {
        const svc = await this.resolveUri(f.uri);
        if (svc) add(svc.root);
      }
    }
    return [...seen.values()];
  }

  dispose(): void {
    this.subscriptions.splice(0).forEach((d) => d.dispose());
    this.subscribedApi = undefined;
    this.emitter.dispose();
  }
}
