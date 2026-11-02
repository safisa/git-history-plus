import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileChange } from '../../../src/shared/types';
import { button, click, flush, key, makeCommit, makeRef, mountApp } from './helpers';

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.restoreAllMocks();
});

const panel = (root: Element) => root.querySelector('aside[aria-label="Commit details"]') as HTMLElement;
const menuItems = () => [...document.querySelectorAll('[role="menuitem"]')] as HTMLElement[];
const menuItem = (label: string) => menuItems().find((i) => i.textContent === label);

const FILES: FileChange[] = [
  { status: 'M', path: 'src/compare.ts', additions: 12, deletions: 3 },
  { status: 'A', path: 'src/locale.ts', additions: 40, deletions: 0 },
  { status: 'D', path: 'old.txt', additions: 0, deletions: 5 },
  { status: 'R', path: 'src/new.ts', oldPath: 'src/old.ts', additions: 1, deletions: 1 },
  { status: 'M', path: 'logo.png', binary: true },
];

async function open(i = 1, over: Parameters<typeof mountApp>[0] = { width: 900 }) {
  const h = await mountApp({ files: () => FILES, ...over });
  cleanup = h.cleanup;
  click(h.row(i));
  await flush();
  return h;
}

describe('DetailsPanel', () => {
  it('shows subject, pre-wrapped body, author, committer when different, and the date with an ISO title', async () => {
    const c = makeCommit(1, {
      subject: 'Merge branch dev',
      body: 'line one\n\n  indented',
      author: { name: 'Dana Levi', email: 'dana@example.com' },
      committer: { name: 'Bot', email: 'bot@example.com' },
      commitDate: 1_700_000_100_000,
    });
    const h = await open(1, { width: 900, commits: [makeCommit(0), c] });
    const p = panel(h.container);
    expect(p.querySelector('h2')?.textContent).toBe('Merge branch dev');
    const body = p.querySelector('.details-body') as HTMLElement;
    expect(body.textContent).toBe('line one\n\n  indented');
    expect(p.textContent).toContain('Dana Levi');
    expect(p.textContent).toContain('dana@example.com');
    expect(p.textContent).toContain('Committed by Bot');
    const time = p.querySelector('time') as HTMLElement;
    expect(time.getAttribute('title')).toBe(new Date(c.authorDate).toISOString());
    expect(time.getAttribute('datetime')).toBe(new Date(c.authorDate).toISOString());
  });

  it('omits the committer line when the author committed', async () => {
    const h = await open();
    expect(panel(h.container).textContent).not.toContain('Committed by');
  });

  it('copy-hash button sends the full hash (no webview clipboard: the extension copies)', async () => {
    const h = await open(2);
    click(button(panel(h.container), 'Copy commit hash'));
    await flush();
    expect(h.sent.filter((r) => r.type === 'copy')).toEqual([{ type: 'copy', text: h.commits[2]!.hash }]);
  });

  describe('with a webview clipboard (Theia)', () => {
    const live = () => h0?.container.querySelector('[aria-live="polite"]')?.textContent ?? '';
    let h0: Awaited<ReturnType<typeof open>> | undefined;
    const withClipboard = (writeText: (t: string) => Promise<void>) =>
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    afterEach(() => {
      delete (navigator as { clipboard?: unknown }).clipboard;
      h0 = undefined;
    });

    it('copies in the webview and sends no copy request when it succeeds', async () => {
      const writeText = vi.fn(async () => undefined);
      withClipboard(writeText);
      h0 = await open(2);
      click(button(panel(h0.container), 'Copy commit hash'));
      await flush();
      expect(writeText).toHaveBeenCalledWith(h0.commits[2]!.hash);
      expect(h0.sent.filter((r) => r.type === 'copy')).toEqual([]);
      expect(live()).toContain('Copied commit hash');
    });

    it('falls back to the copy request when the webview clipboard rejects', async () => {
      withClipboard(async () => {
        throw new DOMException('Document is not focused', 'NotAllowedError');
      });
      h0 = await open(2);
      click(button(panel(h0.container), 'Copy commit hash'));
      await flush();
      expect(h0.sent.filter((r) => r.type === 'copy')).toEqual([{ type: 'copy', text: h0.commits[2]!.hash }]);
      expect(live()).toContain('Copied commit hash');
    });
  });

  it('action buttons send `action` without any webview confirmation', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    const h = await open(2);
    const p = panel(h.container);
    const group = p.querySelector('[role="group"][aria-label="Actions"]') as HTMLElement;
    const labels = [...group.querySelectorAll('button')].map((b) => b.textContent);
    expect(labels).toEqual([
      'Checkout',
      'Cherry-pick',
      'Revert',
      'Merge',
      'Rebase',
      'Reset (soft)',
      'Reset (hard)',
      'Create branch…',
      'Create tag…',
    ]);
    click(button(group, 'Reset (hard)'));
    click(button(group, 'Create branch…'));
    await flush();
    expect(h.sent.filter((r) => r.type === 'action')).toEqual([
      { type: 'action', action: 'resetHard', hash: h.commits[2]!.hash },
      { type: 'action', action: 'createBranch', hash: h.commits[2]!.hash },
    ]);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"], [role="alertdialog"]')).toBeNull();
  });

  it('badge menus carry the branch and tag actions; the remote ✕ removes the remote branch', async () => {
    const c = makeCommit(1, {
      refs: [
        makeRef({ kind: 'branch', name: 'feature/x', fullName: 'refs/heads/feature/x' }),
        makeRef({ kind: 'tag', name: 'v1.2', fullName: 'refs/tags/v1.2' }),
        makeRef({
          kind: 'remote',
          name: 'origin/feature/x',
          fullName: 'refs/remotes/origin/feature/x',
          remote: 'origin',
        }),
      ],
    });
    const h = await open(1, { width: 900, commits: [makeCommit(0), c] });
    const p = panel(h.container);
    const hash = c.hash;

    click(button(p, 'Branch feature/x'));
    expect(menuItems().map((i) => i.textContent)).toEqual([
      'Checkout',
      'Merge into current branch',
      'Rebase current branch onto this',
      'Remove branch',
    ]);
    click(menuItem('Remove branch'));
    click(button(p, 'Tag v1.2'));
    click(menuItem('Remove tag'));
    click(button(p, 'Delete remote branch origin/feature/x'));
    await flush();
    expect(h.sent.filter((r) => r.type === 'action')).toEqual([
      { type: 'action', action: 'removeBranch', hash, ref: 'feature/x' },
      { type: 'action', action: 'removeTag', hash, ref: 'v1.2' },
      { type: 'action', action: 'removeRemoteBranch', hash, ref: 'origin/feature/x' },
    ]);
  });

  it('right-clicking a badge in the table opens that ref’s menu', async () => {
    const c = makeCommit(1, { refs: [makeRef({ kind: 'branch', name: 'dev', fullName: 'refs/heads/dev' })] });
    const h = await mountApp({ width: 900, commits: [makeCommit(0), c] });
    cleanup = h.cleanup;
    const badge = h.row(1).querySelector('.ref-badge') as HTMLElement;
    act(() => {
      badge.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5 }));
    });
    click(menuItem('Checkout'));
    await flush();
    expect(h.sent.filter((r) => r.type === 'action')).toEqual([
      { type: 'action', action: 'checkout', hash: c.hash, ref: 'dev' },
    ]);
  });

  it('"Show in Explorer" sends showInCommitView', async () => {
    const h = await open(3);
    click(button(panel(h.container), 'Show in Explorer'));
    await flush();
    expect(h.sent.at(-1)).toEqual({ type: 'showInCommitView', hash: h.commits[3]!.hash });
  });

  it('"Compare with selected" is hidden until a commit has been selected for comparison', async () => {
    const h = await open(1);
    const compare = () => button(panel(h.container), 'Compare with selected');
    expect(compare()).toBeUndefined();
    click(button(panel(h.container), 'Select for comparison'));
    await flush();
    expect(h.sent.at(-1)).toEqual({ type: 'selectForComparison', hash: h.commits[1]!.hash });
    expect(compare()).toBeUndefined(); // not against itself
    click(h.row(3));
    await flush();
    expect(compare()).toBeDefined();
    click(compare());
    await flush();
    expect(h.sent.at(-1)).toEqual({ type: 'compareWithSelected', hash: h.commits[3]!.hash });
  });

  it('lists files with status, path and +/− counts; a click opens the diff', async () => {
    const h = await open(1);
    const rows = [...panel(h.container).querySelectorAll('[role="listitem"]')];
    expect(rows).toHaveLength(FILES.length);
    expect(panel(h.container).textContent).toContain('Files (5)');
    expect(rows[0]!.querySelector('.file-status')?.textContent).toBe('M');
    expect(rows[0]!.querySelector('.file-status')?.getAttribute('title')).toBe('Modified');
    expect(rows[0]!.textContent).toContain('compare.ts');
    expect(rows[0]!.textContent).toContain('+12');
    expect(rows[0]!.textContent).toContain('−3');
    expect(rows[3]!.textContent).toContain('src/old.ts');
    expect(rows[4]!.textContent).toContain('binary');
    click(rows[3]!.querySelector('button.file-open'));
    await flush();
    expect(h.sent.at(-1)).toEqual({ type: 'openDiff', hash: h.commits[1]!.hash, file: FILES[3] });
    // A double-click: its first click previews; the second click does nothing; the dblclick pins.
    const fileButton = rows[3]!.querySelector('button.file-open')!;
    const before = h.sent.length;
    act(() => {
      fileButton.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
      fileButton.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }));
      fileButton.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 }));
    });
    await flush();
    expect(h.sent.slice(before)).toEqual([
      { type: 'openDiff', hash: h.commits[1]!.hash, file: FILES[3] },
      { type: 'openDiff', hash: h.commits[1]!.hash, file: FILES[3], pinned: true },
    ]);
  });

  it('file context menu: open changes (what a click does), view at commit, compare with working copy, select', async () => {
    const h = await open(1);
    const hash = h.commits[1]!.hash;
    const first = panel(h.container).querySelector('button.file-open') as HTMLElement;
    act(() => first.focus());
    key(first, 'F10', { shiftKey: true });
    expect(menuItems().map((i) => i.textContent)).toEqual([
      'Open Changes',
      'View file at this commit',
      'Compare with working copy',
      'Select for comparison',
    ]);
    click(menuItem('Open Changes'));
    click(button(panel(h.container), 'More actions for src/compare.ts'));
    click(menuItem('View file at this commit'));
    click(button(panel(h.container), 'More actions for src/compare.ts'));
    click(menuItem('Compare with working copy'));
    click(button(panel(h.container), 'More actions for src/compare.ts'));
    click(menuItem('Select for comparison'));
    await flush();
    expect(h.sent.slice(-4)).toEqual([
      { type: 'openDiff', hash, file: FILES[0], pinned: true }, // asked for by name: a tab that stays
      { type: 'openFileAt', hash, path: 'src/compare.ts' },
      { type: 'compareWithWorkspace', hash, path: 'src/compare.ts' },
      { type: 'selectForComparison', hash },
    ]);
    // a deleted file has nothing to show at this commit
    click(button(panel(h.container), 'More actions for old.txt'));
    expect(menuItem('View file at this commit')?.getAttribute('aria-disabled')).toBe('true');
  });

  it('arrow keys move focus between files', async () => {
    const h = await open(1);
    const files = () => [...panel(h.container).querySelectorAll('button.file-open')] as HTMLElement[];
    expect(files().map((f) => f.tabIndex)).toEqual([0, -1, -1, -1, -1]);
    act(() => files()[0]!.focus());
    key(files()[0]!, 'ArrowDown');
    expect(document.activeElement).toBe(files()[1]);
    key(files()[1]!, 'End');
    expect(document.activeElement).toBe(files()[4]);
  });

  it('a commit with 5,000 files renders fewer than 100 file rows', async () => {
    const many: FileChange[] = Array.from({ length: 5000 }, (_, i) => ({
      status: 'M',
      path: `src/file-${i}.ts`,
      additions: 1,
      deletions: 1,
    }));
    const h = await open(1, { width: 900, files: () => many });
    const rows = panel(h.container).querySelectorAll('[role="listitem"]');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(100);
    expect(panel(h.container).textContent).toContain('Files (5000)');
  });

  it('shows a details error inline with Retry', async () => {
    let fail = true;
    const h = await mountApp({
      width: 900,
      files: () => {
        if (fail) throw new Error('fatal: bad object');
        return FILES;
      },
    });
    cleanup = h.cleanup;
    click(h.row(1));
    await flush();
    const alert = panel(h.container).querySelector('[role="alert"]') as HTMLElement;
    expect(alert.textContent).toContain('fatal: bad object');
    fail = false;
    click(button(alert, 'Retry'));
    await flush();
    expect(panel(h.container).querySelector('[role="alert"]')).toBeNull();
    expect(panel(h.container).querySelectorAll('[role="listitem"]')).toHaveLength(FILES.length);
  });

  it('re-fetches the open commit’s details after a refresh push', async () => {
    const h = await open(1);
    const details = () => h.sent.filter((r) => r.type === 'details');
    expect(details()).toHaveLength(1);
    h.push({ type: 'refresh' });
    await flush();
    expect(details()).toHaveLength(2);
    expect(panel(h.container).querySelectorAll('[role="listitem"]')).toHaveLength(FILES.length);
  });

  it('a refresh that lands while the details are loading fetches them again', async () => {
    const h = await mountApp({ width: 900, files: () => FILES });
    cleanup = h.cleanup;
    const details = () => h.sent.filter((r) => r.type === 'details');
    click(h.row(1)); // the details request is sent but not answered yet…
    expect(details()).toHaveLength(1);
    expect(panel(h.container).textContent).toContain('Loading files');
    h.push({ type: 'refresh' }); // …when the refresh arrives
    await flush();
    await flush();
    expect(details()).toHaveLength(2);
    expect(details()[1]).toEqual({ type: 'details', hash: h.commits[1]!.hash });
    expect(panel(h.container).querySelectorAll('[role="listitem"]')).toHaveLength(FILES.length);
  });
});
