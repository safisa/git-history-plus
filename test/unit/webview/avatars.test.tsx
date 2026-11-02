import { afterEach, describe, expect, it } from 'vitest';
import type { Push, ViewSettings } from '../../../src/shared/protocol';
import type { LogPage } from '../../../src/shared/types';
import { createStore, type RequestBody } from '../../../webview/store';
import { SETTINGS, click, flush, linearRow, makeCommit, mountApp } from './helpers';

const ON: ViewSettings = { ...SETTINGS, avatars: 'gravatar' };
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

/** A store whose log answers are given per call; every request is recorded. */
function harness(settings: ViewSettings, pages: LogPage[], avatars: Record<string, string> = {}) {
  const sent: RequestBody[] = [];
  const listeners: ((p: Push) => void)[] = [];
  const store = createStore({
    request: async <T,>(req: RequestBody): Promise<T> => {
      sent.push(req);
      if (req.type === 'log') return pages.shift() as T;
      if (req.type === 'avatars') return avatars as T;
      return [] as T;
    },
    onPush: (l) => {
      listeners.push(l);
      return () => undefined;
    },
  });
  listeners.forEach((l) =>
    l({
      type: 'init',
      mode: 'repo',
      query: { branch: { kind: 'current' }, skip: 0, pageSize: 2 },
      settings,
      repoName: 'r',
    }),
  );
  const avatarRequests = () =>
    sent.filter((r) => r.type === 'avatars') as Extract<RequestBody, { type: 'avatars' }>[];
  const push = (p: Push) => listeners.forEach((l) => l(p));
  return { store, sent, avatarRequests, push };
}

const page = (commits: ReturnType<typeof makeCommit>[], hasMore = false): LogPage => ({
  commits,
  graph: commits.map(linearRow),
  carry: { lanes: [], colors: [], nextColor: 0 },
  hasMore,
});
const by = (i: number, email: string) => makeCommit(i, { author: { name: `A${i}`, email } });

describe('avatars in the store', () => {
  it('never requests avatars when the setting is off', async () => {
    const h = harness(SETTINGS, [page([by(0, 'a@x.com')])]);
    await flush();
    expect(h.avatarRequests()).toEqual([]);
  });

  it('requests the unique (lower-cased) author emails of each page, skipping known ones', async () => {
    const h = harness(ON, [
      page([by(0, 'A@x.com'), by(1, 'a@x.com'), by(2, 'b@x.com')], true),
      page([by(3, 'b@x.com'), by(4, 'c@x.com')]),
    ]);
    await flush();
    expect(h.avatarRequests().map((r) => r.emails)).toEqual([['a@x.com', 'b@x.com']]);
    await h.store.actions.loadMore();
    await flush();
    expect(h.avatarRequests().map((r) => r.emails)).toEqual([['a@x.com', 'b@x.com'], ['c@x.com']]);
  });

  it('batches at most 200 emails per request', async () => {
    const commits = Array.from({ length: 450 }, (_, i) => by(i, `u${i}@x.com`));
    const h = harness(ON, [page(commits)]);
    await flush();
    expect(h.avatarRequests().map((r) => r.emails.length)).toEqual([200, 200, 50]);
  });

  it('keeps only data:image/ URIs from the answer', async () => {
    const h = harness(ON, [page([by(0, 'a@x.com'), by(1, 'b@x.com'), by(2, 'c@x.com')])], {
      'a@x.com': PNG,
      'b@x.com': 'https://evil.example/track.png',
      'c@x.com': 'data:text/html;base64,PHNjcmlwdD4=',
    });
    await flush();
    expect(h.store.getState().avatars).toEqual({ 'a@x.com': PNG });
  });
});

describe('settings push', () => {
  it('applies new settings without reloading the list', async () => {
    const h = harness(SETTINGS, [page([by(0, 'a@x.com')])]);
    await flush();
    const before = h.sent.length;
    h.push({ type: 'settings', settings: { ...SETTINGS, dateFormat: 'relative' } });
    await flush();
    expect(h.store.getState().settings.dateFormat).toBe('relative');
    expect(h.sent.length).toBe(before);
  });

  it('turning avatars on requests them for the loaded commits; off clears them', async () => {
    const h = harness(SETTINGS, [page([by(0, 'a@x.com'), by(1, 'b@x.com')])], { 'a@x.com': PNG });
    await flush();
    expect(h.avatarRequests()).toEqual([]);
    h.push({ type: 'settings', settings: ON });
    await flush();
    expect(h.avatarRequests().map((r) => r.emails)).toEqual([['a@x.com', 'b@x.com']]);
    expect(h.store.getState().avatars).toEqual({ 'a@x.com': PNG });
    h.push({ type: 'settings', settings: SETTINGS });
    await flush();
    expect(h.store.getState().avatars).toEqual({});
    h.push({ type: 'settings', settings: { ...SETTINGS, avatars: 'github' } });
    await flush();
    expect(h.avatarRequests()).toHaveLength(2); // asked again under the new service
  });
});

describe('avatars in the view', () => {
  let cleanup: (() => void) | undefined;
  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  it('renders a 16px round avatar before the author name in the row, and a 32px one in details', async () => {
    const commits = [by(0, 'a@x.com'), by(1, 'b@x.com')];
    const h = await mountApp({ width: 900, commits, settings: ON, avatars: { 'a@x.com': PNG } });
    cleanup = h.cleanup;
    await flush();
    const img = h.row(0).querySelector('.cell-author img') as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.getAttribute('src')).toBe(PNG);
    expect(img.getAttribute('alt')).toBe('');
    expect(img.getAttribute('width')).toBe('16');
    expect(img.className).toContain('avatar');
    expect(h.row(0).querySelector('.cell-author')!.textContent).toBe('A0');
    expect(h.row(1).querySelector('.cell-author img')).toBeNull(); // nothing known: nothing rendered
    click(h.row(0));
    await flush();
    const big = h.container.querySelector('aside .details-meta img') as HTMLImageElement;
    expect(big.getAttribute('src')).toBe(PNG);
    expect(big.getAttribute('width')).toBe('32');
  });

  it('renders no image and sends no request when avatars are off', async () => {
    const h = await mountApp({ width: 900, commits: [by(0, 'a@x.com')], avatars: { 'a@x.com': PNG } });
    cleanup = h.cleanup;
    await flush();
    expect(h.sent.some((r) => r.type === 'avatars')).toBe(false);
    expect(h.container.querySelector('img')).toBeNull();
  });

  it('ignores a non-data URI', async () => {
    const h = await mountApp({
      width: 900,
      commits: [by(0, 'a@x.com')],
      settings: ON,
      avatars: { 'a@x.com': 'https://evil.example/a.png' },
    });
    cleanup = h.cleanup;
    await flush();
    expect(h.sent.some((r) => r.type === 'avatars')).toBe(true);
    expect(h.container.querySelector('img')).toBeNull();
  });
});
