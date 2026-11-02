import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Push, ViewLayout } from '../../../src/shared/protocol';
import {
  WORKTREE,
  type Commit,
  type Containing,
  type FileChange,
  type GraphCarry,
  type LogQuery,
} from '../../../src/shared/types';
import { createStore, type RequestBody } from '../../../webview/store';
import { fileEntries, type FileEntry } from '../../../webview/fileTree';
import {
  button,
  click,
  flush,
  hashOf,
  key,
  linearRow,
  makeCommit,
  mountApp,
  SETTINGS,
  wait,
} from './helpers';

const CARRY: GraphCarry = { lanes: [], colors: [], nextColor: 0 };
const q: LogQuery = { branch: { kind: 'current' }, skip: 0, pageSize: 2 };

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

const saved = (sent: { type: string }[]) =>
  sent.filter((r) => r.type === 'saveLayout').map((r) => (r as unknown as { layout: ViewLayout }).layout);
const resizer = (root: Element, name: string) =>
  root.querySelector(`[aria-label="Resize ${name} column"]`) as HTMLElement;

describe('resizable columns', () => {
  it('Author, Date and Hash have resize handles; the keyboard resizes and the width is saved', async () => {
    const h = await mountApp({ width: 900 });
    cleanup = h.cleanup;
    const author = resizer(h.container, 'Author');
    expect(resizer(h.container, 'Date')).not.toBeNull();
    expect(resizer(h.container, 'Hash')).not.toBeNull();
    expect(author.getAttribute('aria-valuenow')).toBe('120');
    key(author, 'ArrowLeft'); // dragging or arrowing left widens the column
    expect(author.getAttribute('aria-valuenow')).toBe('128');
    expect(h.grid().style.getPropertyValue('--col-author')).toBe('128px');
    key(author, 'Home');
    expect(author.getAttribute('aria-valuenow')).toBe('40');
    await wait(450);
    expect(saved(h.sent)).toEqual([{ columns: { author: 40 } }]);
  });

  it('starts from the remembered widths', async () => {
    const h = await mountApp({ width: 900, layout: { columns: { date: 200, hash: 90 } } });
    cleanup = h.cleanup;
    expect(resizer(h.container, 'Date').getAttribute('aria-valuenow')).toBe('200');
    expect(h.grid().style.getPropertyValue('--col-hash')).toBe('90px');
    expect(h.grid().style.getPropertyValue('--col-author')).toBe('120px');
  });

  it('a drag is saved as soon as it ends, clamped to 40–400 px', async () => {
    const h = await mountApp({ width: 900 });
    cleanup = h.cleanup;
    const hash = resizer(h.container, 'Hash');
    const pointer = (type: string, clientX: number) =>
      hash.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX, button: 0 }));
    act(() => {
      pointer('pointerdown', 800);
      pointer('pointermove', 100);
    });
    act(() => pointer('pointerup', 100));
    await flush();
    expect(hash.getAttribute('aria-valuenow')).toBe('400');
    expect(saved(h.sent)).toEqual([{ columns: { hash: 400 } }]);
  });

  it('the narrow layout has no resizable columns', async () => {
    const h = await mountApp({ width: 500 });
    cleanup = h.cleanup;
    expect(h.container.querySelector('.column-resizer')).toBeNull();
  });
});

describe('changed files as a tree', () => {
  const file = (path: string): FileChange => ({ status: 'M', path });
  const label = (e: FileEntry) =>
    `${'  '.repeat(e.depth)}${e.kind === 'dir' ? `${e.name}/${e.open ? '' : ' (closed)'}` : e.file.path}`;

  it('nests files under folders, merges single-child folders and lists folders first', () => {
    const files = ['src/git/a.ts', 'src/git/b.ts', 'src/z.ts', 'README.md', 'docs/x/y/guide.md'].map(file);
    expect(fileEntries(files, true, new Set()).map(label)).toEqual([
      'docs/x/y/',
      '  docs/x/y/guide.md',
      'src/',
      '  git/',
      '    src/git/a.ts',
      '    src/git/b.ts',
      '  src/z.ts',
      'README.md',
    ]);
    expect(fileEntries(files, true, new Set(['src'])).map(label)).toEqual([
      'docs/x/y/',
      '  docs/x/y/guide.md',
      'src/ (closed)',
      'README.md',
    ]);
    expect(fileEntries(files, false, new Set()).map(label)).toEqual(files.map((f) => f.path));
  });

  it('the toggle switches the details files to a tree, is remembered, and folders fold', async () => {
    const files = [file('src/git/a.ts'), file('README.md')];
    const h = await mountApp({ width: 900, files: () => files });
    cleanup = h.cleanup;
    click(h.row(0));
    await flush();
    const toggle = button(h.container, 'View as tree')!;
    expect(toggle.querySelector('.codicon')!.classList.contains('codicon-list-tree')).toBe(true);
    click(toggle);
    await flush();
    // Now it offers the way back: the list icon, named for what it does.
    expect(toggle.getAttribute('aria-label')).toBe('View as list');
    expect(toggle.querySelector('.codicon')!.classList.contains('codicon-list-flat')).toBe(true);
    expect(saved(h.sent)).toEqual([{ fileTree: true }]);
    const rows = () => [...h.container.querySelectorAll('.details-side .file-row')].map((r) => r.textContent);
    expect(rows()).toEqual(['Folder: src/git', 'MModified: a.ts', 'MModified: README.md']);
    const folder = h.container.querySelector('.details-side .dir-row .file-open') as HTMLButtonElement;
    expect(folder.getAttribute('aria-expanded')).toBe('true');
    folder.focus();
    key(folder, 'ArrowLeft');
    expect(rows()).toEqual(['Folder: src/git', 'MModified: README.md']);
    key(folder, 'ArrowRight');
    expect(rows()).toHaveLength(3);
    click(folder);
    expect(rows()).toHaveLength(2);
  });

  it('starts as a tree when that was remembered', async () => {
    const h = await mountApp({ width: 900, layout: { fileTree: true }, files: () => [file('a/b.ts')] });
    cleanup = h.cleanup;
    click(h.row(0));
    await flush();
    expect(button(h.container, 'View as list')).toBeDefined();
    expect(h.container.querySelector('.details-side .dir-row')).not.toBeNull();
  });
});

describe('branches containing a commit', () => {
  const containing = (): Containing => ({
    branches: ['main', 'dev', 'origin/main'],
    tags: ['v1.0'],
    branchCount: 12,
    tagCount: 1,
  });

  it('the details list the branches and tags that include the commit', async () => {
    const h = await mountApp({ width: 900, containing });
    cleanup = h.cleanup;
    click(h.row(1));
    await flush();
    expect(h.sent.some((r) => r.type === 'containing')).toBe(false); // not before the selection rests
    await wait(350);
    expect(h.sent).toContainEqual({ type: 'containing', hash: h.commits[1]!.hash });
    const lines = [...h.container.querySelectorAll('.details-side .containing-line')].map(
      (l) => l.textContent,
    );
    expect(lines).toEqual(['Branchesmain, dev, origin/main, and 9 more', 'Tagsv1.0']);
  });

  it('resting the pointer on a row shows a card with them; moving off or clicking hides it', async () => {
    const h = await mountApp({ width: 900, containing });
    cleanup = h.cleanup;
    const over = (el: Element) =>
      act(() => {
        el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: 50, clientY: 50 }));
      });
    over(h.row(2).querySelector('.subject')!);
    await wait(300);
    expect(document.querySelector('.hover-card')).toBeNull(); // not before the pointer rests
    await wait(500);
    const card = document.querySelector('.hover-card')!;
    expect(card.getAttribute('role')).toBe('tooltip');
    expect(card.textContent).toContain('main, dev, origin/main, and 9 more');
    act(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(document.querySelector('.hover-card')).toBeNull();
    over(h.row(3));
    await wait(750);
    expect(document.querySelector('.hover-card')).not.toBeNull();
    act(() => {
      h.container
        .querySelector('.commit-scroll')!
        .dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    });
    expect(document.querySelector('.hover-card')).toBeNull(); // moving off the rows hides it
    over(h.row(1));
    await wait(750);
    expect(document.querySelector('.hover-card')).not.toBeNull();
    act(() => {
      h.container.querySelector('.commit-scroll')!.dispatchEvent(new Event('scroll'));
    });
    expect(document.querySelector('.hover-card')).toBeNull(); // so does scrolling
  });
});

describe('the uncommitted changes row', () => {
  const worktree = (): Commit => ({
    ...makeCommit(0),
    hash: WORKTREE,
    parents: [hashOf(1)],
    author: { name: '', email: '' },
    committer: { name: '', email: '' },
    subject: 'Uncommitted changes (2 files)',
  });
  const commits = () => [worktree(), makeCommit(1), makeCommit(2)];

  it('sits on top with a dashed hollow node and no author, date or hash', async () => {
    const h = await mountApp({ width: 900, commits: commits() });
    cleanup = h.cleanup;
    const row = h.row(0);
    expect(row.classList.contains('is-worktree')).toBe(true);
    expect(row.querySelector('.graph-node')!.classList.contains('is-worktree')).toBe(true);
    expect(row.querySelector('.cell-hash')!.textContent).toBe('');
    expect(row.querySelector('.cell-date')!.textContent).toBe('');
    expect(row.textContent).toContain('Uncommitted changes (2 files)');
  });

  it('its details show the files only; a file opens its working-tree diff; no commit actions', async () => {
    const files = (hash: string): FileChange[] =>
      hash === WORKTREE ? [{ status: 'M', path: 'a.txt' }] : [{ status: 'A', path: 'z.txt' }];
    const h = await mountApp({ width: 900, commits: commits(), files });
    cleanup = h.cleanup;
    click(h.row(0));
    await flush();
    const side = h.container.querySelector('.details-side')!;
    expect(side.textContent).toContain('Staged, unstaged and untracked changes, compared with HEAD.');
    expect(side.querySelector('[aria-label="Actions"]')).toBeNull();
    expect(button(side, 'More actions')).toBeUndefined();
    expect(h.sent.some((r) => r.type === 'containing')).toBe(false);
    click(side.querySelector('.file-open'));
    await flush();
    expect(h.sent.at(-1)).toEqual({ type: 'openDiff', hash: WORKTREE, file: { status: 'M', path: 'a.txt' } });
  });

  it('has no row menu and no copy, and no branches card', async () => {
    const h = await mountApp({ width: 900, commits: commits() });
    cleanup = h.cleanup;
    act(() => {
      h.row(0).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    });
    expect(document.querySelector('[role="menu"]')).toBeNull();
    h.grid().focus();
    key(h.grid(), 'Home');
    key(h.grid(), 'c');
    await flush();
    expect(h.sent.some((r) => r.type === 'copy')).toBe(false);
    act(() => {
      h.row(0).dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    await wait(750);
    expect(document.querySelector('.hover-card')).toBeNull();
  });

  it('the next page skips only real commits', async () => {
    const sent: RequestBody[] = [];
    let push: ((p: Push) => void) | undefined;
    const store = createStore({
      request: async <T,>(req: RequestBody): Promise<T> => {
        sent.push(req);
        const list = req.type === 'log' && req.query.skip === 0 ? commits() : [makeCommit(3)];
        return { commits: list, graph: list.map(linearRow), carry: CARRY, hasMore: true } as T;
      },
      onPush: (l) => {
        push = l;
        return () => undefined;
      },
    });
    push!({ type: 'init', mode: 'repo', query: q, settings: SETTINGS, repoName: 'r' });
    await flush();
    await store.actions.loadMore();
    expect(sent.filter((r) => r.type === 'log').map((r) => (r as { query: LogQuery }).query.skip)).toEqual([
      0, 2,
    ]);
  });
});

describe('review fixes', () => {
  it('the column handles are one Tab stop; Up and Down move between them', async () => {
    const h = await mountApp({ width: 900 });
    cleanup = h.cleanup;
    const handles = [...h.container.querySelectorAll<HTMLElement>('.column-resizer')];
    expect(handles.map((r) => r.tabIndex)).toEqual([0, -1, -1]);
    handles[0]!.focus();
    key(handles[0]!, 'ArrowDown');
    expect(document.activeElement).toBe(handles[1]);
    expect(handles.map((r) => r.tabIndex)).toEqual([-1, 0, -1]);
    key(handles[1]!, 'ArrowUp');
    expect(document.activeElement).toBe(handles[0]);
  });

  it('a failed branch lookup says so in the card instead of loading forever', async () => {
    const h = await mountApp({
      width: 900,
      containing: () => {
        throw new Error('git failed');
      },
    });
    cleanup = h.cleanup;
    act(() => {
      h.row(1).dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    await wait(750);
    expect(document.querySelector('.hover-card')!.textContent).toBe('Could not list the branches');
  });

  it('the uncommitted details are asked for afresh when selected again or the view regains focus', async () => {
    const worktree = {
      ...makeCommit(0),
      hash: WORKTREE,
      parents: [hashOf(1)],
      subject: 'Uncommitted changes',
    };
    const h = await mountApp({
      width: 900,
      commits: [worktree, makeCommit(1)],
      path: 'docs',
      mode: 'folder',
    });
    cleanup = h.cleanup;
    const asked = () => h.sent.filter((r) => r.type === 'details' && r.hash === WORKTREE);
    click(h.row(0));
    await flush();
    expect(asked()).toEqual([{ type: 'details', hash: WORKTREE, path: 'docs' }]);
    click(h.row(1));
    await flush();
    click(h.row(0));
    await flush();
    expect(asked()).toHaveLength(2);
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await flush();
    expect(asked()).toHaveLength(3);
  });
});
