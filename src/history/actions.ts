import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import * as vscode from 'vscode';
import { GitError } from '../git/exec';
import type { CommitAction, Hash } from '../shared/types';
import type { HandlerCtx } from './requestHandler';

interface Confirm {
  message: string;
  label: string;
}

const unchanged = { changed: false };
const changed = { changed: true };

function firstLine(s: string): string {
  return (
    s
      .split(/\r?\n|\r/)
      .map((l) => l.trim())
      .find((l) => l !== '') ?? ''
  );
}

const CONFLICT_OPS: Partial<Record<CommitAction, string>> = {
  merge: 'Merge',
  rebase: 'Rebase',
  cherryPick: 'Cherry-pick',
  revert: 'Revert',
};

/** True when merge/cherry-pick/revert/rebase left the repo mid-operation. */
async function operationInProgress(ctx: HandlerCtx): Promise<boolean> {
  for (const head of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD']) {
    try {
      await ctx.svc.run(['rev-parse', '-q', '--verify', head]);
      return true;
    } catch {
      /* not in progress */
    }
  }
  for (const dir of ['rebase-merge', 'rebase-apply']) {
    try {
      const p = (await ctx.svc.run(['rev-parse', '--git-path', dir])).trim();
      if (existsSync(isAbsolute(p) ? p : join(ctx.svc.root, p))) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

function requireRef(action: CommitAction, ref: string | undefined): string {
  if (!ref) throw new Error(`The "${action}" action requires a ref`);
  return ref;
}

async function confirm(c: Confirm): Promise<boolean> {
  return (await vscode.window.showWarningMessage(c.message, { modal: true }, c.label)) === c.label;
}

/** Validates a new branch/tag name. Never lets a leading '-' reach git; the name is always an argv element. */
async function validateName(
  ctx: HandlerCtx,
  kind: 'branch' | 'tag',
  value: string,
): Promise<string | undefined> {
  if (value.trim() === '') return 'A name is required';
  if (value.startsWith('-')) return 'A name cannot start with "-"';
  const args =
    kind === 'branch' ? ['check-ref-format', '--branch', value] : ['check-ref-format', `refs/tags/${value}`];
  try {
    const out = await ctx.svc.run(args);
    if (kind === 'branch' && out.trim() !== value) return 'Not a valid branch name';
    return undefined;
  } catch (e) {
    if (e instanceof GitError) return `Not a valid ${kind} name`;
    throw e;
  }
}

async function createRef(kind: 'branch' | 'tag', hash: Hash, ctx: HandlerCtx): Promise<{ changed: boolean }> {
  const name = await vscode.window.showInputBox({
    prompt: kind === 'branch' ? 'New branch name' : 'New tag name',
    validateInput: (v) => validateName(ctx, kind, v),
  });
  if (name === undefined || (await validateName(ctx, kind, name)) !== undefined) return unchanged;
  await ctx.svc.run([kind, '--end-of-options', name, hash]);
  if (kind === 'branch') {
    const pick = await vscode.window.showInformationMessage(`Created branch ${name}`, 'Checkout');
    if (pick === 'Checkout') {
      try {
        await ctx.svc.run(['checkout', '--end-of-options', name]);
      } catch (e) {
        if (!(e instanceof GitError)) throw e;
        void vscode.window.showErrorMessage(
          `Git History Plus: ${firstLine(e.stderr) || firstLine(e.message)}`,
        );
      }
    }
  }
  return changed;
}

/**
 * Checks out a ref from a badge. A remote branch (origin/x) is never checked out detached: it switches
 * to the local branch x, creating it to track origin/x when it does not exist yet.
 */
async function checkoutRef(ref: string, ctx: HandlerCtx): Promise<{ changed: boolean }> {
  const refs = await ctx.svc.refs();
  const remote = refs.some((r) => r.kind === 'branch' && r.name === ref)
    ? undefined
    : refs.find((r) => r.kind === 'remote' && r.name === ref && r.remote !== undefined);
  if (!remote) {
    if (!(await confirm({ message: `Checkout ${ref}?`, label: 'Checkout' }))) return unchanged;
    await ctx.svc.run(['checkout', '--end-of-options', ref, '--']);
    return changed;
  }
  const local = ref.slice(remote.remote!.length + 1);
  const exists = refs.some((r) => r.kind === 'branch' && r.name === local);
  const message = exists
    ? `Checkout remote branch "${ref}"? This switches to the existing local branch "${local}".`
    : `Checkout remote branch "${ref}"? This creates a local branch "${local}" that tracks it.`;
  if (!(await confirm({ message, label: 'Checkout' }))) return unchanged;
  await ctx.svc.run(
    exists ? ['switch', '--end-of-options', local] : ['switch', '--track', '--end-of-options', ref],
  );
  return changed;
}

async function removeBranch(ref: string, ctx: HandlerCtx): Promise<{ changed: boolean }> {
  if (!(await confirm({ message: `Remove branch "${ref}"?`, label: 'Remove Branch' }))) return unchanged;
  try {
    await ctx.svc.run(['branch', '-d', '--end-of-options', ref]);
  } catch (e) {
    if (!(e instanceof GitError) || !/not fully merged/i.test(e.stderr)) throw e;
    const force = await confirm({
      message: `Branch "${ref}" is not fully merged. Its unmerged commits may be lost. Delete it anyway?`,
      label: 'Force Remove',
    });
    if (!force) return unchanged;
    await ctx.svc.run(['branch', '-D', '--end-of-options', ref]);
  }
  return changed;
}

async function removeRemoteBranch(ref: string, ctx: HandlerCtx): Promise<{ changed: boolean }> {
  const slash = ref.indexOf('/');
  if (slash <= 0 || slash === ref.length - 1) throw new Error(`"${ref}" is not a <remote>/<branch> ref`);
  const remote = ref.slice(0, slash);
  const branch = ref.slice(slash + 1);
  const remotes = (await ctx.svc.run(['remote'])).split(/\r?\n/).filter(Boolean);
  if (!remotes.includes(remote)) {
    void vscode.window.showErrorMessage(`Git History Plus: Unknown remote "${remote}"`);
    return unchanged;
  }
  const ok = await confirm({
    message: `Delete branch "${branch}" from remote "${remote}"? This cannot be undone.`,
    label: 'Delete Remote Branch',
  });
  if (!ok) return unchanged;
  await ctx.svc.run(['push', remote, '--delete', '--end-of-options', branch]);
  return changed;
}

/** Runs one commit action. Git failures are reported with showErrorMessage and yield {changed:false}. */
export async function runCommitAction(
  action: CommitAction,
  hash: Hash,
  ref: string | undefined,
  ctx: HandlerCtx,
): Promise<{ changed: boolean }> {
  const git = (args: string[]) => ctx.svc.run(args);
  const guarded = async (c: Confirm | undefined, args: string[]): Promise<{ changed: boolean }> => {
    if (c && !(await confirm(c))) return unchanged;
    await git(args);
    return changed;
  };
  const target = ref ?? hash;
  try {
    switch (action) {
      case 'checkout':
        return ref
          ? await checkoutRef(ref, ctx)
          : await guarded({ message: `Checkout ${hash.slice(0, 8)}?`, label: 'Checkout' }, [
              'checkout',
              '--detach',
              hash,
            ]);
      case 'cherryPick':
        return await guarded(undefined, ['cherry-pick', hash]);
      case 'revert':
        return await guarded({ message: `Revert commit ${hash.slice(0, 8)}?`, label: 'Revert' }, [
          'revert',
          '--no-edit',
          hash,
        ]);
      case 'merge':
        return await guarded(
          { message: `Merge ${ref ?? hash.slice(0, 8)} into the current branch?`, label: 'Merge' },
          ['merge', '--no-edit', '--end-of-options', target],
        );
      case 'rebase':
        return await guarded(
          { message: `Rebase the current branch onto ${ref ?? hash.slice(0, 8)}?`, label: 'Rebase' },
          ['rebase', '--end-of-options', target],
        );
      case 'resetSoft':
        return await guarded(
          { message: `Soft reset the current branch to ${hash.slice(0, 8)}?`, label: 'Reset' },
          ['reset', '--soft', hash],
        );
      case 'resetHard':
        return await guarded(
          {
            message: `Hard reset the current branch to ${hash.slice(0, 8)}? This discards all uncommitted changes.`,
            label: 'Reset (Hard)',
          },
          ['reset', '--hard', hash],
        );
      case 'createBranch':
        return await createRef('branch', hash, ctx);
      case 'createTag':
        return await createRef('tag', hash, ctx);
      case 'removeTag': {
        const tag = requireRef(action, ref);
        return await guarded({ message: `Remove tag "${tag}"?`, label: 'Remove Tag' }, [
          'tag',
          '-d',
          '--end-of-options',
          tag,
        ]);
      }
      case 'removeBranch':
        return await removeBranch(requireRef(action, ref), ctx);
      case 'removeRemoteBranch':
        return await removeRemoteBranch(requireRef(action, ref), ctx);
    }
  } catch (e) {
    if (!(e instanceof GitError)) throw e;
    const op = CONFLICT_OPS[action];
    if (op) {
      if (await operationInProgress(ctx)) {
        void vscode.window.showWarningMessage(
          `Git History Plus: ${op} stopped with conflicts — resolve them in Source Control.`,
        );
      } else {
        void vscode.window.showErrorMessage(
          `Git History Plus: ${firstLine(e.stderr) || firstLine(e.message)}`,
        );
      }
      return changed; // the repo may be mid-operation, so the panel must refresh
    }
    void vscode.window.showErrorMessage(`Git History Plus: ${firstLine(e.stderr) || firstLine(e.message)}`);
    return unchanged;
  }
}
