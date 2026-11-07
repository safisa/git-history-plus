import { describe, expect, it } from 'vitest';
import { LOG_COUNT_MAX, type Push } from '../../../src/shared/protocol';
import { WORKTREE, type GraphCarry, type LogPage, type LogQuery, type Ref } from '../../../src/shared/types';
import { createStore, type RequestBody } from '../../../webview/store';
import { SETTINGS, linearRow, makeCommit, makeRef } from './helpers';

const QUERY: LogQuery = { branch: { kind: 'current' }, skip: 0, pageSize: 2 };
const carry = (n: number): GraphCarry => ({ lanes: [`c${n}`], colors: [n], nextColor: n + 1 });

function page(from: number, n: number, hasMore: boolean, c = carry(from + n)): LogPage {
  const commits = Array.from({ length: n }, (_, i) => makeCommit(from + i));
  return { commits, graph: commits.map(linearRow), carry: c, hasMore };
}

interface Pending {
  req: RequestBody;
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

function harness() {
  const pending: Pending[] = [];
  const refsCalls: RequestBody[] = [];
  const listeners: ((p: Push) => void)[] = [];
  const store = createStore({
    request: <T>(req: RequestBody) =>
      new Promise<T>((resolve, reject) => {
        if (req.type === 'refs') {
          refsCalls.push(req);
          return resolve([makeRef({ kind: 'branch', name: 'main' })] as T);
        }
        pending.push({ req, resolve: resolve as (v: unknown) => void, reject });
      }),
    onPush: (l) => {
      listeners.push(l);
      return () => undefined;
    },
  });
  const push = (p: Push) => listeners.forEach((l) => l(p));
  const init = () => push({ type: 'init', mode: 'repo', query: QUERY, settings: SETTINGS, repoName: 'repo' });
  /** Resolves the oldest pending log request with `p` and lets the store settle. */
  const answer = async (p: LogPage | Error) => {
    const next = pending.shift();
    if (!next) throw new Error('no pending request');
    if (p instanceof Error) next.reject(p);
    else next.resolve(p);
    await new Promise((r) => setTimeout(r, 0));
    return next.req;
  };
  return { store, pending, push, init, answer, refsCalls };
}

describe('store', () => {
  it('ignores a refresh that arrives before init (it would load the unfiltered repository)', () => {
    const h = harness();
    h.push({ type: 'refresh' });
    expect(h.pending).toHaveLength(0);
    expect(h.refsCalls).toHaveLength(0);
    h.init();
    expect(h.pending.map((p) => p.req.type)).toEqual(['log']);
  });

  it('starts loading and applies the init push, then loads the first page', async () => {
    const h = harness();
    expect(h.store.getState().loading).toBe(true);
    h.init();
    const s = h.store.getState();
    expect(s.mode).toBe('repo');
    expect(s.repoName).toBe('repo');
    expect(s.settings).toEqual(SETTINGS);
    const req = await h.answer(page(0, 2, true));
    expect(req).toEqual({ type: 'log', query: QUERY });
    expect(h.store.getState().commits).toHaveLength(2);
    expect(h.store.getState().loading).toBe(false);
    expect(h.store.getState().refs.map((r: Ref) => r.name)).toEqual(['main']);
  });

  it('appends pages and passes carry through', async () => {
    const h = harness();
    h.init();
    await h.answer(page(0, 2, true, carry(1)));
    void h.store.actions.loadMore();
    void h.store.actions.loadMore(); // deduplicated while a page is in flight
    expect(h.pending).toHaveLength(1);
    const req2 = await h.answer(page(2, 2, true, carry(2)));
    expect(req2).toEqual({ type: 'log', query: { ...QUERY, skip: 2, graphCarry: carry(1) } });
    void h.store.actions.loadMore();
    const req3 = await h.answer(page(4, 1, false, carry(3)));
    expect(req3).toMatchObject({ query: { skip: 4, graphCarry: carry(2) } });

    const s = h.store.getState();
    expect(s.commits.map((c) => c.subject)).toEqual([0, 1, 2, 3, 4].map((i) => `subject ${i}`));
    expect(s.graph).toHaveLength(5);
    expect(s.carry).toEqual(carry(3));
    expect(s.hasMore).toBe(false);
    void h.store.actions.loadMore();
    expect(h.pending).toHaveLength(0);
  });

  it('notifies subscribers on change', async () => {
    const h = harness();
    let calls = 0;
    const off = h.store.subscribe(() => calls++);
    h.init();
    await h.answer(page(0, 1, false));
    expect(calls).toBeGreaterThan(0);
    off();
  });

  it('on refresh reloads as many commits as were loaded and keeps a selection from a deep page', async () => {
    const h = harness();
    h.init();
    await h.answer(page(0, 2, true, carry(10)));
    void h.store.actions.loadMore();
    await h.answer(page(2, 2, true, carry(11)));
    h.store.actions.select(makeCommit(3).hash); // on the second page
    h.push({ type: 'refresh' });
    // Everything that was listed is asked for at once, not page by page.
    const first = await h.answer(page(0, 4, true, carry(21)));
    expect(first).toEqual({ type: 'log', query: QUERY, count: 4 });
    expect(h.pending).toHaveLength(0);
    const s = h.store.getState();
    expect(s.commits.map((c) => c.hash)).toEqual([0, 1, 2, 3].map((i) => makeCommit(i).hash));
    expect(s.graph).toHaveLength(4);
    expect(s.carry).toEqual(carry(21));
    expect(s.hasMore).toBe(true);
    expect(s.loading).toBe(false);
    expect(s.selected).toBe(makeCommit(3).hash);

    h.store.actions.select(makeCommit(1).hash);
    h.store.actions.refresh();
    await h.answer(page(5, 2, false)); // commit 1 is gone and nothing more is left
    expect(h.pending).toHaveLength(0);
    expect(h.store.getState().selected).toBeUndefined();
  });

  it('a query change (not a refresh) still loads only page one', async () => {
    const h = harness();
    h.init();
    await h.answer(page(0, 2, true));
    void h.store.actions.loadMore();
    await h.answer(page(2, 2, true));
    h.store.actions.setQuery({ text: 'x' });
    await h.answer(page(0, 2, true));
    expect(h.pending).toHaveLength(0);
    expect(h.store.getState().commits).toHaveLength(2);
  });

  it('setQuery reloads from page one with the merged query', async () => {
    const h = harness();
    h.init();
    await h.answer(page(0, 2, true));
    h.store.actions.setQuery({ text: 'fix', skip: 99 });
    const req = await h.answer(page(0, 1, false));
    expect(req).toEqual({ type: 'log', query: { ...QUERY, text: 'fix' } });
    expect(h.store.getState().query.text).toBe('fix');
  });

  it('ignores a stale first-page response that arrives after a newer one', async () => {
    const h = harness();
    h.init();
    h.store.actions.setQuery({ text: 'new' });
    const [stale, fresh] = h.pending.splice(0, 2);
    fresh!.resolve(page(10, 1, false));
    stale!.resolve(page(0, 2, true));
    await new Promise((r) => setTimeout(r, 0));
    expect(h.store.getState().commits.map((c) => c.subject)).toEqual(['subject 10']);
    expect(h.store.getState().hasMore).toBe(false);
  });

  it('records an error and clears it on the next successful load', async () => {
    const h = harness();
    h.init();
    await h.answer(new Error('git exploded'));
    expect(h.store.getState()).toMatchObject({ error: 'git exploded', loading: false });
    void h.store.actions.loadFirst();
    expect(h.store.getState().error).toBeUndefined();
    await h.answer(page(0, 1, false));
    expect(h.store.getState().commits).toHaveLength(1);
  });

  it('selects the exact hash match returned by a search', async () => {
    const h = harness();
    h.init();
    await h.answer({ ...page(3, 1, false), exactHash: makeCommit(3).hash });
    expect(h.store.getState().selected).toBe(makeCommit(3).hash);
  });

  it('fetches refs on init and refresh only, not on every query change', async () => {
    const h = harness();
    h.init();
    await h.answer(page(0, 1, false));
    expect(h.refsCalls).toHaveLength(1);
    h.store.actions.setQuery({ text: 'f' });
    await h.answer(page(0, 1, false));
    h.store.actions.setQuery({ text: 'fi' });
    await h.answer(page(0, 1, false));
    void h.store.actions.loadFirst();
    await h.answer(page(0, 1, false));
    expect(h.refsCalls).toHaveLength(1);
    h.push({ type: 'refresh' });
    await h.answer(page(0, 1, false));
    expect(h.refsCalls).toHaveLength(2);
  });

  it('keeps the exact-hash match of the last search in state', async () => {
    const h = harness();
    h.init();
    await h.answer({ ...page(3, 1, false), exactHash: makeCommit(3).hash });
    expect(h.store.getState().exactHash).toBe(makeCommit(3).hash);
    h.store.actions.setQuery({ text: undefined });
    await h.answer(page(0, 2, false));
    expect(h.store.getState().exactHash).toBeUndefined();
  });

  it('setQuery drops keys set to undefined', async () => {
    const h = harness();
    h.init();
    await h.answer(page(0, 1, false));
    h.store.actions.setQuery({ text: 'x', author: 'dana' });
    await h.answer(page(0, 1, false));
    h.store.actions.setQuery({ text: undefined, author: undefined });
    const req = await h.answer(page(0, 1, false));
    expect(req).toEqual({ type: 'log', query: QUERY });
    expect(Object.keys(h.store.getState().query)).not.toContain('text');
  });

  it('loads details once per hash, one request at a time, latest selection wins', async () => {
    const h = harness();
    h.init();
    await h.answer(page(0, 4, false));
    const [a, b, c] = [0, 1, 2].map((i) => makeCommit(i).hash) as [string, string, string];
    void h.store.actions.loadDetails(a);
    void h.store.actions.loadDetails(a); // in flight: not repeated
    void h.store.actions.loadDetails(b); // queued...
    void h.store.actions.loadDetails(c); // ...and replaced by the latest
    expect(h.pending.map((p) => p.req)).toEqual([{ type: 'details', hash: a }]);
    await h.answer({ commit: makeCommit(0), files: [] } as never);
    expect(h.store.getState().details[a]?.commit.hash).toBe(a);
    expect(h.pending.map((p) => p.req)).toEqual([{ type: 'details', hash: c }]);
    await h.answer(new Error('bad object'));
    expect(h.store.getState().detailsErrors[c]).toBe('bad object');
    void h.store.actions.loadDetails(a); // cached
    expect(h.pending).toHaveLength(0);
  });

  it('remembers the hash this view selected for comparison once the extension accepts it', async () => {
    const h = harness();
    h.init();
    await h.answer(page(0, 2, false));
    const hash = makeCommit(1).hash;
    void h.store.actions.selectForComparison(hash);
    expect(h.store.getState().comparisonBase).toBeUndefined();
    const req = await h.answer(undefined as never);
    expect(req).toEqual({ type: 'selectForComparison', hash });
    expect(h.store.getState().comparisonBase).toBe(hash);
  });

  it('refreshRepo asks the extension to drop its caches, then reloads refs and page one', async () => {
    const h = harness();
    h.init();
    await h.answer(page(0, 2, false));
    void h.store.actions.refreshRepo();
    expect(await h.answer(undefined as never)).toEqual({ type: 'refreshRepo' });
    expect(await h.answer(page(0, 1, false))).toEqual({ type: 'log', query: QUERY, count: 2 });
    expect(h.refsCalls).toHaveLength(2);
  });

  it('on refresh asks again for whatever a short answer left out, keeping the old list meanwhile', async () => {
    const h = harness();
    h.init();
    await h.answer(page(0, 2, true, carry(10)));
    void h.store.actions.loadMore();
    await h.answer(page(2, 2, true, carry(11)));
    h.store.actions.refresh();
    expect(await h.answer(page(0, 3, true, carry(20)))).toEqual({ type: 'log', query: QUERY, count: 4 });
    // The old list stays on screen until the reload has caught up with it.
    expect(h.store.getState().commits.map((c) => c.hash)).toEqual(
      [0, 1, 2, 3].map((i) => makeCommit(i).hash),
    );
    expect(await h.answer(page(3, 2, true, carry(21)))).toEqual({
      type: 'log',
      query: { ...QUERY, skip: 3, graphCarry: carry(20) },
      count: 1,
    });
    expect(h.pending).toHaveLength(0);
    expect(h.store.getState().commits).toHaveLength(5);
    expect(h.store.getState().carry).toEqual(carry(21));
  });

  it('on refresh counts commits, not the uncommitted row the extension adds on top', async () => {
    const h = harness();
    h.init();
    const withRow = (p: LogPage): LogPage => ({
      ...p,
      commits: [makeCommit(99, { hash: WORKTREE, subject: 'Uncommitted changes (1 file)' }), ...p.commits],
      graph: [linearRow(), ...p.graph],
    });
    await h.answer(withRow(page(0, 2, true, carry(10))));
    void h.store.actions.loadMore();
    expect(await h.answer(page(2, 2, true, carry(11)))).toMatchObject({ query: { skip: 2 } });
    expect(h.store.getState().commits).toHaveLength(5);
    h.store.actions.refresh();
    expect(await h.answer(withRow(page(0, 4, true, carry(20))))).toEqual({
      type: 'log',
      query: QUERY,
      count: 4,
    });
    expect(h.pending).toHaveLength(0);
    expect(h.store.getState().commits).toHaveLength(5);
  });

  it('on refresh never asks for more than LOG_COUNT_MAX commits in one request', async () => {
    const h = harness();
    h.init();
    await h.answer(page(0, LOG_COUNT_MAX + 10, true));
    h.store.actions.refresh();
    expect(await h.answer(page(0, LOG_COUNT_MAX, true, carry(1)))).toMatchObject({ count: LOG_COUNT_MAX });
    expect(await h.answer(page(LOG_COUNT_MAX, 10, false))).toMatchObject({
      query: { skip: LOG_COUNT_MAX },
      count: 10,
    });
    expect(h.store.getState().commits).toHaveLength(LOG_COUNT_MAX + 10);
  });

  it('send reports a failed fire-and-forget request as a dismissible notice', async () => {
    const h = harness();
    h.init();
    await h.answer(page(0, 1, false));
    const sent = h.store.actions.send({ type: 'openFileAt', hash: makeCommit(0).hash, path: 'a' });
    await h.answer(new Error('path not in commit'));
    expect(await sent).toBeUndefined();
    expect(h.store.getState().notice).toBe('path not in commit');
    h.store.actions.dismissNotice();
    expect(h.store.getState().notice).toBeUndefined();
  });
});
