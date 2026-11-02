import type * as vscode from 'vscode';

function isUri(v: unknown): v is vscode.Uri {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as { scheme?: unknown }).scheme === 'string' &&
    typeof (v as { fsPath?: unknown }).fsPath === 'string'
  );
}

/**
 * Normalizes the many shapes VS Code passes as a command argument: a Uri, `{ resourceUri }`
 * (SCM resource state / tree item), `{ rootUri }` (the SourceControl of an scm/title button), an
 * array of those (first wins), or `[Uri, Uri[]]` from an explorer multi-select.
 */
export function normalizeUriArg(arg: unknown): vscode.Uri | undefined {
  if (isUri(arg)) return arg;
  if (Array.isArray(arg)) return normalizeUriArg(arg[0]);
  if (typeof arg === 'object' && arg !== null) {
    const r = (arg as { resourceUri?: unknown }).resourceUri;
    if (isUri(r)) return r;
    const root = (arg as { rootUri?: unknown }).rootUri;
    if (isUri(root)) return root;
  }
  return undefined;
}
