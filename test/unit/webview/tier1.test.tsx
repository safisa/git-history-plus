import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { createStore, type RequestBody } from '../../../webview/store';
import { button, click, flush, linearRow, makeCommit, mountApp, SETTINGS, wait } from './helpers';

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

const options = () => [...document.querySelectorAll('[role="option"]')] as HTMLElement[];
const details = (root: Element) => root.querySelector('.details-side') as HTMLElement;

describe('Fetch', () => {
  it('the Fetch button asks the extension to fetch all remotes', async () => {
    const h = await mountApp({ width: 900 });
    cleanup = h.cleanup;
    click(button(h.container, 'Fetch from all remotes'));
    await flush();
    expect(h.sent.some((r) => r.type === 'fetch')).toBe(true);
  });
});

describe('author filter: Me', () => {
  it('offers "Me" right after "Any author" and filters by the configured email', async () => {
    const h = await mountApp({
      width: 900,
      me: { name: 'Safi', email: 'safi@example.com' },
      authors: [{ name: 'Dana', email: 'dana@example.com' }],
    });
    cleanup = h.cleanup;
    click(button(h.container, /^Author/));
    await flush();
    expect(options().map((o) => o.textContent)).toEqual([
      'Any author',
      'Mesafi@example.com',
      'Danadana@example.com',
    ]);
    click(options()[1]);
    await flush();
    expect(h.logs().at(-1)!.query.author).toBe('<safi@example[.]com>');
    expect(button(h.container, /^Author/)!.textContent).toContain('Me');
  });

  it('without a configured git user there is no "Me"', async () => {
    const h = await mountApp({ width: 900, authors: [{ name: 'Dana', email: 'dana@example.com' }] });
    cleanup = h.cleanup;
    click(button(h.container, /^Author/));
    await flush();
    expect(options().map((o) => o.textContent)).toEqual(['Any author', 'Danadana@example.com']);
  });
});

describe('issue links', () => {
  const issueLinks = [
    { pattern: '\\b([A-Z][A-Z0-9]+-\\d+)\\b', url: 'https://jira.example.com/browse/$1' },
    { pattern: '(', url: 'https://broken.example.com/$1' }, // invalid: ignored
    { pattern: 'evil', url: 'javascript:alert(1)' }, // not http(s): ignored
  ];

  it('links issue keys in the subject and body; a click opens the link through the extension', async () => {
    const commits = [makeCommit(0, { subject: 'Fix ABC-12 crash, evil', body: 'See also K2-7.' })];
    const h = await mountApp({ width: 900, commits, settings: { ...SETTINGS, issueLinks } });
    cleanup = h.cleanup;
    click(h.row(0));
    await flush();
    const links = [...details(h.container).querySelectorAll('.issue-link')] as HTMLButtonElement[];
    expect(details(h.container).querySelector('a[href]')).toBeNull(); // the host would open an href itself
    expect(links.map((a) => a.textContent)).toEqual(['ABC-12', 'K2-7']);
    expect(details(h.container).querySelector('.details-subject')!.textContent).toBe(
      'Fix ABC-12 crash, evil',
    );
    click(links[0]);
    await flush();
    expect(h.sent.find((r) => r.type === 'openExternal')).toMatchObject({
      url: 'https://jira.example.com/browse/ABC-12',
    });
  });

  it('commit text stays text: markup in a message is not rendered', async () => {
    const commits = [makeCommit(0, { subject: '<img src=x onerror=alert(1)> ABC-1' })];
    const h = await mountApp({ width: 900, commits, settings: { ...SETTINGS, issueLinks } });
    cleanup = h.cleanup;
    click(h.row(0));
    await flush();
    expect(details(h.container).querySelector('img[src="x"]')).toBeNull();
    expect(details(h.container).querySelector('.issue-link')!.textContent).toBe('ABC-1');
  });
});

describe('parents and Go to HEAD', () => {
  it('lists the parents; clicking a loaded parent selects it', async () => {
    const h = await mountApp({ width: 900 });
    cleanup = h.cleanup;
    click(h.row(1));
    await flush();
    const parent = button(details(h.container), `Go to parent ${h.commits[2]!.hash.slice(0, 7)}`);
    click(parent);
    await flush();
    expect(h.store.getState().selected).toBe(h.commits[2]!.hash);
  });

  it('a parent that is not loaded is searched for by its hash', async () => {
    const h = await mountApp({ width: 900 });
    cleanup = h.cleanup;
    click(h.row(4)); // its parent, commit 5, is not in the list
    await flush();
    click(button(details(h.container), /^Go to parent/));
    await wait(10);
    expect(h.logs().at(-1)!.query.text).toBe(h.commits[4]!.parents[0]);
  });

  it('Go to HEAD selects the HEAD commit', async () => {
    const h = await mountApp({ width: 900, head: makeCommit(3).hash });
    cleanup = h.cleanup;
    click(button(h.container, 'Go to HEAD'));
    await flush();
    expect(h.store.getState().selected).toBe(makeCommit(3).hash);
  });
});

describe('folder history', () => {
  it('a double-click does not open a version diff (there is no single file to step through)', async () => {
    const h = await mountApp({ width: 900, mode: 'folder', path: 'src' });
    cleanup = h.cleanup;
    act(() => {
      h.row(1).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    await flush();
    expect(h.sent.some((r) => r.type === 'openVersionDiff')).toBe(false);
  });
});

describe('store.reveal', () => {
  it('loads further pages to reach a commit, then selects it', async () => {
    const all = Array.from({ length: 6 }, (_, i) => makeCommit(i));
    const store = createStore({
      request: async <T,>(req: RequestBody): Promise<T> => {
        if (req.type !== 'log') return [] as T;
        const page = all.slice(req.query.skip, req.query.skip + 2);
        return {
          commits: page,
          graph: page.map(linearRow),
          carry: { lanes: [], colors: [], nextColor: 0 },
          hasMore: req.query.skip + 2 < all.length,
        } as T;
      },
      onPush: () => () => undefined,
    });
    await store.actions.loadFirst();
    expect(await store.actions.reveal(all[5]!.hash)).toBe(true);
    expect(store.getState().commits).toHaveLength(6);
    expect(store.getState().selected).toBe(all[5]!.hash);
    expect(await store.actions.reveal(makeCommit(9).hash)).toBe(false);
  });
});

describe('store.reveal: the latest request wins', () => {
  const pagedStore = () => {
    const all = Array.from({ length: 6 }, (_, i) => makeCommit(i));
    const store = createStore({
      request: async <T,>(req: RequestBody): Promise<T> => {
        if (req.type !== 'log') return [] as T;
        await new Promise((r) => setTimeout(r, 5));
        const page = all.slice(req.query.skip, req.query.skip + 2);
        return {
          commits: page,
          graph: page.map(linearRow),
          carry: { lanes: [], colors: [], nextColor: 0 },
          hasMore: req.query.skip + 2 < all.length,
        } as T;
      },
      onPush: () => () => undefined,
    });
    return { all, store };
  };

  it('a second reveal supersedes the first', async () => {
    const { all, store } = pagedStore();
    await store.actions.loadFirst();
    const first = store.actions.reveal(all[5]!.hash);
    const second = store.actions.reveal(all[1]!.hash);
    expect(await first).toBeUndefined();
    expect(await second).toBe(true);
    expect(store.getState().selected).toBe(all[1]!.hash);
  });

  it('a new query supersedes a reveal that is still loading pages', async () => {
    const { all, store } = pagedStore();
    await store.actions.loadFirst();
    const pending = store.actions.reveal(all[5]!.hash);
    await wait(2);
    store.actions.setQuery({ text: 'fix' });
    expect(await pending).toBeUndefined();
  });

  it('a reveal waits for a page already in flight instead of giving up', async () => {
    const { all, store } = pagedStore();
    const first = store.actions.loadFirst();
    expect(await store.actions.reveal(all[1]!.hash)).toBe(true);
    await first;
  });

  it('revealing the selected commit again still asks the table to scroll', async () => {
    const { all, store } = pagedStore();
    await store.actions.loadFirst();
    await store.actions.reveal(all[0]!.hash);
    const count = store.getState().revealCount;
    await store.actions.reveal(all[0]!.hash);
    expect(store.getState().revealCount).toBe(count + 1);
  });
});
