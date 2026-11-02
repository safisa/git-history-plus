import * as vscode from 'vscode';
import type { GitService } from './gitService';

interface GitRepositoryLike {
  fetch(options: { all?: boolean; prune?: boolean }): Promise<void>;
}

interface GitExtensionLike {
  getAPI(version: 1): { getRepository(uri: vscode.Uri): GitRepositoryLike | null };
}

/** vscode.git's handle on the repository at `root`, when the extension is active and has it open. */
function gitRepository(root: string): GitRepositoryLike | undefined {
  try {
    const ext = vscode.extensions.getExtension<GitExtensionLike>('vscode.git');
    if (!ext?.isActive) return undefined;
    return ext.exports.getAPI(1).getRepository(vscode.Uri.file(root)) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * vscode.git rejects with a plain object (its GitError is not an Error) carrying git's stderr; show
 * that rather than a JSON dump. Our own GitError is an Error and already says what failed.
 */
function fetchError(e: unknown): Error {
  if (e instanceof Error) return e;
  const { stderr, message } = (e ?? {}) as { stderr?: unknown; message?: unknown };
  const text = (typeof stderr === 'string' && stderr.trim()) || (typeof message === 'string' && message);
  return new Error(text || 'git fetch failed');
}

/**
 * Fetches every remote and prunes deleted branches, with a progress notification. Goes through
 * vscode.git when it has the repository, so its credential prompts and askpass work. Otherwise runs
 * git directly, where terminal prompts are off and a remote that needs credentials fails; ssh can
 * still wait on a host key or passphrase, so that path can be cancelled from the notification.
 */
export async function fetchAll(svc: GitService): Promise<void> {
  const repo = gitRepository(svc.root);
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Git History Plus: fetching from all remotes…',
      cancellable: !repo,
    },
    async (_progress, token) => {
      try {
        if (repo) {
          await repo.fetch({ all: true, prune: true });
          return;
        }
        const abort = new AbortController();
        const sub = token?.onCancellationRequested(() => abort.abort());
        try {
          await svc.run(['fetch', '--all', '--prune'], { signal: abort.signal });
        } finally {
          sub?.dispose();
        }
      } catch (e) {
        throw fetchError(e);
      }
    },
  );
}
