import { useSyncExternalStore } from 'react';
import type { HistoryMode, Push, ViewLayout, ViewSettings } from '../src/shared/protocol';
import type {
  Commit,
  CommitDetails,
  Containing,
  GraphCarry,
  GraphRow,
  Hash,
  LogPage,
  LogQuery,
  Ref,
} from '../src/shared/types';
import { WORKTREE } from '../src/shared/types';
import * as rpc from './rpc';
import type { RequestBody } from './rpc';

export type { RequestBody } from './rpc';

export interface State {
  mode: HistoryMode;
  repoName: string;
  /** The query the extension opened the view with; filters are layered on top of it. */
  initQuery: LogQuery;
  query: LogQuery;
  commits: Commit[];
  graph: GraphRow[];
  carry?: GraphCarry;
  hasMore: boolean;
  /** True while any page is in flight, and before the `init` push arrives. */
  loading: boolean;
  selected?: Hash;
  /** Set when the last search was a hash that resolved to exactly this commit. */
  exactHash?: Hash;
  details: Record<Hash, CommitDetails>;
  detailsErrors: Record<Hash, string>;
  refs: Ref[];
  settings: ViewSettings;
  error?: string;
  /** The commit this view last sent `selectForComparison` for (webview-local knowledge). */
  comparisonBase?: Hash;
  /** A failed one-off request (open a diff, copy, …), shown until dismissed. */
  notice?: string;
  /** Author avatars as data:image/ URIs, keyed by avatarKey(email); empty while avatars are off. */
  avatars: Record<string, string>;
  /** Bumped by every successful reveal, so the table scrolls even when the selection is unchanged. */
  revealCount: number;
  /** Branches and tags that include a commit, as loaded so far (null: failed; cleared by a refresh). */
  containing: Record<Hash, Containing | null>;
  /** The layout remembered by the extension, from `init`. */
  layout?: ViewLayout;
}

export interface Actions {
  /** Loads page one of the current query (no carry); keeps the selection if it is still listed. */
  loadFirst(): Promise<void>;
  /** Appends the next page. A no-op while loading, when nothing is left, or after a failed load. */
  loadMore(): Promise<void>;
  select(hash: Hash | undefined): void;
  /**
   * Selects `hash` and scrolls to it, first waiting for any page in flight and then loading up to
   * REVEAL_PAGES more. Resolves false when it is not in the list (the caller then searches for it),
   * and undefined when a newer reveal or a new query superseded it (the caller then does nothing).
   */
  reveal(hash: Hash): Promise<boolean | undefined>;
  /** Merges into the query and reloads from page one. */
  setQuery(patch: Partial<LogQuery>): void;
  /**
   * Reloads refs and as many commits as are loaded now (page by page), dropping cached details (refs
   * may have moved). The selection is kept when its commit is still listed.
   */
  refresh(): Promise<void>;
  /** Repeats whichever load failed last. */
  retry(): Promise<void>;
  /** Asks the extension to drop its caches, then reloads refs and page one. */
  refreshRepo(): Promise<void>;
  /**
   * Fetches a commit's details into `details` unless cached. One request at a time: while one is in
   * flight only the most recent other hash is queued, so holding an arrow key can't pile up git calls.
   */
  loadDetails(hash: Hash): Promise<void>;
  /** Loads which branches and tags include `hash`, once (until a refresh); a failure is stored as null. */
  loadContaining(hash: Hash): void;
  /** Sends a one-off request. Resolves `{ result }`, or undefined after a failure, which becomes `notice`. */
  send<T = unknown>(req: RequestBody): Promise<{ result: T } | undefined>;
  selectForComparison(hash: Hash): Promise<void>;
  dismissNotice(): void;
}

export interface StoreDeps {
  request<T>(req: RequestBody): Promise<T>;
  onPush(listener: (p: Push) => void): () => void;
}

export interface Store {
  getState(): State;
  subscribe(listener: () => void): () => void;
  actions: Actions;
}

const INITIAL_QUERY: LogQuery = { branch: { kind: 'current' }, skip: 0, pageSize: 100 };
const INITIAL: State = {
  mode: 'repo',
  repoName: '',
  initQuery: INITIAL_QUERY,
  query: INITIAL_QUERY,
  commits: [],
  graph: [],
  hasMore: false,
  loading: true,
  details: {},
  detailsErrors: {},
  refs: [],
  settings: { dateFormat: 'relative', avatars: 'off', locale: 'en' },
  avatars: {},
  revealCount: 0,
  containing: {},
};

/** How many more pages `reveal` loads looking for a commit before giving up. */
const REVEAL_PAGES = 10;

/** At most this many emails per `avatars` request (the extension rejects more). */
const AVATAR_BATCH = 200;
const MAX_EMAIL = 254;

/** The key an author's avatar is stored under (the extension answers with lower-cased emails). */
export const avatarKey = (email: string): string => email.trim().toLowerCase();

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** How many real commits are listed: the next page skips that many (the uncommitted row isn't one). */
const loaded = (commits: Commit[]) => commits.length - (commits[0]?.hash === WORKTREE ? 1 : 0);

/** The query for page one: no skip, no graph carry and no keys left set to `undefined`. */
function firstPage(q: LogQuery): LogQuery {
  const out = { ...q, skip: 0 };
  delete out.graphCarry;
  for (const k of Object.keys(out) as (keyof LogQuery)[]) if (out[k] === undefined) delete out[k];
  return out;
}

export function createStore(deps: StoreDeps): Store {
  let state = INITIAL;
  const listeners = new Set<() => void>();
  /** Bumped by every first-page load; responses from an older generation are dropped. */
  let generation = 0;
  let lastFailed: 'first' | 'more' = 'first';

  const set = (patch: Partial<State>) => {
    state = { ...state, ...patch };
    for (const l of listeners) l();
  };

  /** Emails already asked for under the current avatars setting (answered or not). */
  const avatarsAsked = new Set<string>();

  /** Applies changed view settings; a different avatars service starts the avatar map afresh. */
  function applySettings(settings: ViewSettings): void {
    const avatarsChanged = settings.avatars !== state.settings.avatars;
    set(avatarsChanged ? { settings, avatars: {} } : { settings });
    if (!avatarsChanged) return;
    avatarsAsked.clear();
    requestAvatars(state.commits);
  }

  /** Asks the extension for the avatars of `commits`' authors not asked for yet, in batches. */
  function requestAvatars(commits: Commit[]): void {
    const mode = state.settings.avatars;
    if (mode === 'off') return;
    const emails: string[] = [];
    for (const c of commits) {
      const key = avatarKey(c.author.email);
      if (key === '' || key.length > MAX_EMAIL || avatarsAsked.has(key)) continue;
      avatarsAsked.add(key);
      emails.push(key);
    }
    for (let i = 0; i < emails.length; i += AVATAR_BATCH) {
      const batch = emails.slice(i, i + AVATAR_BATCH);
      deps.request<Record<string, unknown>>({ type: 'avatars', emails: batch }).then(
        (answer) => {
          // Dropped when the setting changed meanwhile (the batch was asked for another service).
          if (state.settings.avatars !== mode || typeof answer !== 'object' || answer === null) return;
          const accepted: Record<string, string> = {};
          for (const key of batch) {
            const uri = answer[key];
            // Only inline images may reach an <img>: never a URL the view would fetch.
            if (typeof uri === 'string' && uri.startsWith('data:image/')) accepted[key] = uri;
          }
          if (Object.keys(accepted).length > 0) set({ avatars: { ...state.avatars, ...accepted } });
        },
        () => undefined, // an avatar is decoration; the author name is still shown
      );
    }
  }

  /** Bumped whenever refs are requested; an older answer is dropped. */
  let refsGeneration = 0;
  function loadRefs(): void {
    const gen = ++refsGeneration;
    deps.request<Ref[]>({ type: 'refs' }).then(
      (refs) => gen === refsGeneration && set({ refs }),
      () => undefined, // refs only feed the branch picker; a log failure is what gets reported
    );
  }

  /**
   * Loads page one of the current query, then (for a refresh) further pages until at least `keep`
   * commits are loaded again. The old list stays on screen until the new one is complete; the
   * selection survives when its commit is anywhere in the reloaded set.
   */
  async function loadFirst(keep = 0): Promise<void> {
    const gen = ++generation;
    set({ loading: true, error: undefined });
    try {
      const query = firstPage(state.query);
      let page = await deps.request<LogPage>({ type: 'log', query });
      if (gen !== generation) return;
      let { commits, graph, carry, hasMore } = page;
      while (page.exactHash === undefined && hasMore && commits.length < keep) {
        page = await deps.request<LogPage>({
          type: 'log',
          query: { ...query, skip: loaded(commits), graphCarry: carry },
        });
        if (gen !== generation) return;
        if (page.commits.length === 0) break; // never spin on an empty page
        commits = [...commits, ...page.commits];
        graph = [...graph, ...page.graph];
        carry = page.carry;
        hasMore = page.hasMore;
      }
      const kept = commits.some((c) => c.hash === state.selected) ? state.selected : undefined;
      set({
        commits,
        graph,
        carry,
        hasMore,
        loading: false,
        selected: page.exactHash ?? kept,
        exactHash: page.exactHash,
      });
      requestAvatars(commits);
    } catch (e) {
      if (gen !== generation) return;
      lastFailed = 'first';
      set({ loading: false, error: message(e) });
    }
  }

  async function fetchMore(): Promise<void> {
    if (state.loading || !state.hasMore) return;
    const gen = generation;
    const query: LogQuery = { ...firstPage(state.query), skip: loaded(state.commits) };
    if (state.carry) query.graphCarry = state.carry;
    set({ loading: true, error: undefined });
    try {
      const page = await deps.request<LogPage>({ type: 'log', query });
      if (gen !== generation) return;
      set({
        commits: [...state.commits, ...page.commits],
        graph: [...state.graph, ...page.graph],
        carry: page.carry,
        hasMore: page.hasMore,
        loading: false,
      });
      requestAvatars(page.commits);
    } catch (e) {
      if (gen !== generation) return;
      lastFailed = 'more';
      set({ loading: false, error: message(e) });
    }
  }

  /** Bumped by refresh so details fetched before it are not cached after it. */
  let detailsGeneration = 0;
  let detailsInFlight: Hash | undefined;
  let detailsQueued: Hash | undefined;

  async function loadDetails(hash: Hash): Promise<void> {
    if (state.details[hash] || hash === detailsInFlight) return;
    if (detailsInFlight !== undefined) {
      detailsQueued = hash;
      return;
    }
    const gen = detailsGeneration;
    detailsInFlight = hash;
    if (state.detailsErrors[hash] !== undefined) {
      const errors = { ...state.detailsErrors };
      delete errors[hash];
      set({ detailsErrors: errors });
    }
    try {
      // The uncommitted changes are scoped like the row: to the view's path, if it has one.
      const path = hash === WORKTREE ? state.query.path : undefined;
      const d = await deps.request<CommitDetails>({
        type: 'details',
        hash,
        ...(path === undefined ? {} : { path }),
      });
      if (gen === detailsGeneration) set({ details: { ...state.details, [hash]: d } });
    } catch (e) {
      if (gen === detailsGeneration) set({ detailsErrors: { ...state.detailsErrors, [hash]: message(e) } });
    } finally {
      // After a refresh the slot already belongs to newer requests.
      if (gen === detailsGeneration) {
        detailsInFlight = undefined;
        const next = detailsQueued;
        detailsQueued = undefined;
        if (next !== undefined) void loadDetails(next);
      }
    }
  }

  /** Hashes asked for since the last refresh (answered or not). */
  const containingAsked = new Set<Hash>();
  /** Bumped by refresh, so an answer from before it is dropped. */
  let containingGeneration = 0;
  function loadContaining(hash: Hash): void {
    if (containingAsked.has(hash)) return;
    containingAsked.add(hash);
    const gen = containingGeneration;
    deps.request<Containing>({ type: 'containing', hash }).then(
      (c) => {
        if (gen === containingGeneration && typeof c === 'object' && c !== null)
          set({ containing: { ...state.containing, [hash]: c } });
      },
      () => {
        if (gen === containingGeneration) set({ containing: { ...state.containing, [hash]: null } });
      },
    );
  }

  async function send<T>(req: RequestBody): Promise<{ result: T } | undefined> {
    try {
      return { result: await deps.request<T>(req) };
    } catch (e) {
      set({ notice: message(e) });
      return undefined;
    }
  }

  function refresh(): Promise<void> {
    // Whatever the view was waiting for is asked for again; the stale answer is dropped by generation.
    // (A cached hash is re-requested by the view itself, which sees its details go missing.)
    const wanted = detailsQueued ?? detailsInFlight;
    detailsGeneration++;
    detailsInFlight = undefined;
    detailsQueued = undefined;
    containingAsked.clear();
    containingGeneration++;
    set({ details: {}, detailsErrors: {}, containing: {} });
    loadRefs();
    const page = loadFirst(state.commits.length);
    if (wanted !== undefined) void loadDetails(wanted);
    return page;
  }

  /** Resolves once no page is loading. */
  function idle(): Promise<void> {
    if (!state.loading) return Promise.resolve();
    return new Promise((resolve) => {
      const listener = () => {
        if (state.loading) return;
        listeners.delete(listener);
        resolve();
      };
      listeners.add(listener);
    });
  }

  let revealSeq = 0;
  async function reveal(hash: Hash): Promise<boolean | undefined> {
    const seq = ++revealSeq;
    await idle();
    const gen = generation;
    const current = () => seq === revealSeq && gen === generation;
    for (let page = 0; ; page++) {
      if (!current()) return undefined;
      if (state.commits.some((c) => c.hash === hash)) {
        set({ selected: hash, revealCount: state.revealCount + 1 });
        return true;
      }
      if (page >= REVEAL_PAGES || !state.hasMore || state.error !== undefined) return false;
      const before = state.commits.length;
      await fetchMore();
      if (state.commits.length === before) return current() ? false : undefined; // a failed or dropped load
    }
  }

  const actions: Actions = {
    loadFirst: () => loadFirst(),
    // The table asks for more whenever it scrolls near the end; after a failure only Retry may ask.
    loadMore: () => (state.error === undefined ? fetchMore() : Promise.resolve()),
    select: (hash) => {
      // The uncommitted changes keep changing: selecting them (again) asks for them afresh.
      if (hash === WORKTREE && state.details[WORKTREE]) {
        const details = { ...state.details };
        delete details[WORKTREE];
        set({ selected: hash, details });
      } else set({ selected: hash });
    },
    reveal,
    setQuery: (patch) => {
      set({ query: firstPage({ ...state.query, ...patch }) });
      void loadFirst();
    },
    refresh,
    retry: () => (lastFailed === 'more' && state.commits.length > 0 ? fetchMore() : loadFirst()),
    refreshRepo: async () => {
      await send({ type: 'refreshRepo' });
      await refresh();
    },
    loadDetails,
    loadContaining,
    send,
    selectForComparison: async (hash) => {
      try {
        await deps.request({ type: 'selectForComparison', hash });
        set({ comparisonBase: hash });
      } catch (e) {
        set({ notice: message(e) });
      }
    },
    dismissNotice: () => set({ notice: undefined }),
  };

  /** Until `init` the view has no query of its own, so a refresh would load the whole repository. */
  let initialized = false;
  deps.onPush((p) => {
    if (p.type === 'init') {
      initialized = true;
      set({
        mode: p.mode,
        repoName: p.repoName,
        initQuery: p.query,
        query: p.query,
        settings: p.settings,
        layout: p.layout,
      });
      loadRefs();
      void loadFirst();
    } else if (p.type === 'settings') {
      applySettings(p.settings);
    } else if (initialized) {
      void actions.refresh();
    }
  });

  return {
    getState: () => state,
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    actions,
  };
}

let appStore: Store | undefined;

/** The webview's single store, wired to the extension through `rpc`. */
export function getAppStore(): Store {
  return (appStore ??= createStore({ request: rpc.request, onPush: rpc.onPush }));
}

export function useStore(store: Store = getAppStore()): [State, Actions] {
  const state = useSyncExternalStore(store.subscribe, store.getState);
  return [state, store.actions];
}
