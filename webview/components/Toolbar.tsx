import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type RefObject } from 'react';
import { literalPattern } from '../../src/shared/literalPattern';
import { parseSearch } from '../../src/shared/search';
import type { BranchFilter, LogQuery, Person, Ref } from '../../src/shared/types';
import { isMac } from '../platform';
import type { Actions } from '../store';
import { Picker, type PickerGroup } from './Picker';

export interface ToolbarProps {
  initQuery: LogQuery;
  branch: BranchFilter;
  refs: Ref[];
  exactHash?: string;
  actions: Actions;
  searchRef: RefObject<HTMLInputElement | null>;
  /** Puts this text in the search box and searches at once (a commit to find by its hash). */
  searchFor?: { text: string };
  /** Escape in an empty search box: focus goes back to the commit list. */
  onLeaveSearch?(): void;
  onGoToHead(): void;
}

interface Dates {
  maxCount: string;
  since: string;
  until: string;
}

const SEARCH_DEBOUNCE_MS = 300;
const NO_DATES: Dates = { maxCount: '', since: '', until: '' };

/** The picker's `--author` pattern: this exact email, matched literally whatever git's regex flavour. */
export function authorPattern(p: Person): string {
  return `<${literalPattern(p.email)}>`;
}

const branchId = (b: BranchFilter) => (b.kind === 'ref' ? `ref:${b.ref}` : b.kind);
const isCount = (s: string) => /^\s*\d*\s*$/.test(s);

function datesOf(q: LogQuery): Dates {
  return { maxCount: q.maxCount ? String(q.maxCount) : '', since: q.since ?? '', until: q.until ?? '' };
}

/** The author filter: a person from the list, or the configured git user ("Me"). */
type AuthorPick = Person & { me?: boolean };

/** Branch, author, search, date/count filters, then Compare…, Go to HEAD, Fetch and Refresh. */
export function Toolbar(p: ToolbarProps) {
  const { actions, initQuery } = p;
  const [search, setSearch] = useState('');
  const [author, setAuthor] = useState<AuthorPick>();
  const [authors, setAuthors] = useState<Person[]>();
  const [me, setMe] = useState<Person>();
  const [fetching, setFetching] = useState(false);
  const [authorsLoading, setAuthorsLoading] = useState(false);
  const [dates, setDates] = useState<Dates>(() => datesOf(initQuery));
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const lastApplied = useRef('');

  /** Rebuilds the filter part of the query; search tokens win over the pickers. */
  const apply = (next: { search: string; author: AuthorPick | undefined; dates: Dates }) => {
    clearTimeout(timer.current);
    const parsed = parseSearch(next.search);
    const count = Number.parseInt(next.dates.maxCount, 10);
    const patch: Partial<LogQuery> = {
      text: parsed.text,
      path: parsed.path ?? initQuery.path,
      author: parsed.author ?? (next.author ? authorPattern(next.author) : initQuery.author),
      since: parsed.since ?? (next.dates.since.trim() || undefined),
      until: parsed.until ?? (next.dates.until.trim() || undefined),
      maxCount: count > 0 ? count : undefined,
    };
    const key = JSON.stringify(patch);
    if (key === lastApplied.current) return;
    lastApplied.current = key;
    actions.setQuery(patch);
  };

  // A new init (the panel was re-opened with another query) resets the filters.
  useEffect(() => {
    clearTimeout(timer.current);
    setSearch('');
    setAuthor(undefined);
    setDates(datesOf(initQuery));
    lastApplied.current = '';
  }, [initQuery]);
  useEffect(() => () => clearTimeout(timer.current), []);

  // Latest filters for the searchFor effect, which must run only when a new request arrives.
  const filters = useRef({ author, dates });
  filters.current = { author, dates };
  useEffect(() => {
    if (!p.searchFor) return;
    setSearch(p.searchFor.text);
    apply({ search: p.searchFor.text, ...filters.current });
  }, [p.searchFor]);

  const onSearch = (value: string) => {
    setSearch(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => apply({ search: value, author, dates }), SEARCH_DEBOUNCE_MS);
  };
  const clearSearch = () => {
    setSearch('');
    apply({ search: '', author, dates });
  };

  const branchGroups = useMemo<PickerGroup[]>(() => {
    const of = (kinds: Ref['kind'][]) =>
      p.refs.filter((r) => kinds.includes(r.kind)).map((r) => ({ id: `ref:${r.fullName}`, label: r.name }));
    return [
      {
        options: [
          { id: 'current', label: 'Current branch' },
          { id: 'all', label: 'All branches' },
        ],
      },
      { label: 'Branches', options: of(['head', 'branch']) },
      { label: 'Remote', options: of(['remote']) },
      { label: 'Tags', options: of(['tag']) },
    ];
  }, [p.refs]);
  const branchLabel =
    p.branch.kind === 'current'
      ? 'Current branch'
      : p.branch.kind === 'all'
        ? 'All branches'
        : (p.refs.find((r) => r.fullName === (p.branch as { ref: string }).ref)?.name ?? p.branch.ref);
  const pickBranch = (id: string) => {
    const branch: BranchFilter =
      id === 'current' || id === 'all' ? { kind: id } : { kind: 'ref', ref: id.slice('ref:'.length) };
    actions.setQuery({ branch });
  };

  const authorGroups = useMemo<PickerGroup[]>(
    () => [
      {
        options: [
          { id: 'any', label: 'Any author' },
          ...(me ? [{ id: 'me', label: 'Me', detail: me.email }] : []),
        ],
      },
      { options: (authors ?? []).map((a) => ({ id: `author:${a.email}`, label: a.name, detail: a.email })) },
    ],
    [authors, me],
  );
  const loadAuthors = () => {
    if (authors || authorsLoading) return;
    setAuthorsLoading(true);
    // A failure leaves the list unset, so the next open asks again (send() reports the error).
    void Promise.all([
      actions.send<Person[]>({ type: 'authors' }),
      actions.send<Person | undefined>({ type: 'me' }),
    ]).then(([list, self]) => {
      setAuthorsLoading(false);
      if (list) setAuthors(list.result);
      if (self?.result?.email) setMe(self.result);
    });
  };
  const pickAuthor = (id: string) => {
    const next: AuthorPick | undefined =
      id === 'any'
        ? undefined
        : id === 'me' && me
          ? { ...me, me: true }
          : authors?.find((a) => `author:${a.email}` === id);
    setAuthor(next);
    apply({ search, author: next, dates });
  };
  const fetchAll = () => {
    if (fetching) return;
    setFetching(true);
    void actions.send({ type: 'fetch' }).finally(() => setFetching(false));
  };

  const applyDates = (next: Dates) => {
    setDates(next);
    apply({ search, author, dates: next });
  };

  const datesActive = dates.maxCount.trim() !== '' || dates.since.trim() !== '' || dates.until.trim() !== '';

  return (
    <div className="toolbar">
      <div role="search" aria-label="History filters" className="toolbar-filters">
        <Picker
          name="Branch"
          icon="git-branch"
          valueLabel={branchLabel}
          selectedId={branchId(p.branch)}
          groups={branchGroups}
          onPick={pickBranch}
        />
        <Picker
          name="Author"
          icon="person"
          valueLabel={author?.me ? 'Me' : (author?.name ?? 'Any author')}
          selectedId={author?.me ? 'me' : author ? `author:${author.email}` : 'any'}
          groups={authorGroups}
          loading={authorsLoading}
          onOpen={loadAuthors}
          onPick={pickAuthor}
        />
        <div className="search-box">
          <span className="codicon codicon-search" aria-hidden="true" />
          {p.exactHash && search.trim() !== '' && (
            <span className="search-chip">
              Commit {p.exactHash.slice(0, 7)}
              <button
                type="button"
                className="icon-button"
                aria-label="Clear commit search"
                title="Clear commit search"
                onClick={() => {
                  clearSearch();
                  p.searchRef.current?.focus();
                }}
              >
                <span className="codicon codicon-close" aria-hidden="true" />
              </button>
            </span>
          )}
          <input
            ref={p.searchRef}
            type="text"
            className="search-input"
            aria-label="Search commits"
            aria-keyshortcuts={isMac() ? '/ Meta+F' : '/ Control+F'}
            placeholder="Search message or hash (author: path: since: until:)"
            spellCheck={false}
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Escape') return;
              // First Escape clears the search, the next one goes back to the list.
              e.preventDefault();
              e.stopPropagation();
              if (search !== '') clearSearch();
              else p.onLeaveSearch?.();
            }}
          />
        </div>
        <DateFilter value={dates} active={datesActive} onApply={applyDates} />
      </div>
      <div role="group" aria-label="History actions" className="toolbar-actions">
        <button
          type="button"
          className="toolbar-button"
          title="Compare branches, tags or commits"
          onClick={() => void actions.send({ type: 'compareRefs' })}
        >
          <span className="codicon codicon-git-compare" aria-hidden="true" />
          <span className="toolbar-button-label">Compare…</span>
        </button>
        <button
          type="button"
          className="toolbar-button icon-only"
          aria-label="Go to HEAD"
          title="Go to HEAD"
          onClick={p.onGoToHead}
        >
          <span className="codicon codicon-location" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="toolbar-button icon-only"
          aria-label="Fetch from all remotes"
          title="Fetch from all remotes"
          aria-busy={fetching || undefined}
          disabled={fetching}
          onClick={fetchAll}
        >
          <span
            className={fetching ? 'codicon codicon-sync codicon-modifier-spin' : 'codicon codicon-repo-fetch'}
            aria-hidden="true"
          />
        </button>
        <button
          type="button"
          className="toolbar-button icon-only"
          aria-label="Refresh"
          title="Refresh"
          onClick={() => void actions.refreshRepo()}
        >
          <span className="codicon codicon-refresh" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

/** "Last N commits", Since and Until, passed through to git as typed. */
function DateFilter(p: { value: Dates; active: boolean; onApply(d: Dates): void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Dates>(NO_DATES);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstRef = useRef<HTMLInputElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    firstRef.current?.focus();
    const outside = (e: Event) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', outside, true);
    return () => document.removeEventListener('mousedown', outside, true);
  }, [open]);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };
  const submit = (next: Dates) => {
    close();
    p.onApply(next);
  };
  const countOk = isCount(draft.maxCount);
  const field = (k: keyof Dates, label: string, placeholder: string) => (
    <div className="form-row">
      <label htmlFor={`${id}-${k}`}>{label}</label>
      <input
        id={`${id}-${k}`}
        ref={k === 'maxCount' ? firstRef : undefined}
        type="text"
        inputMode={k === 'maxCount' ? 'numeric' : undefined}
        placeholder={placeholder}
        spellCheck={false}
        aria-invalid={k === 'maxCount' && !countOk ? true : undefined}
        value={draft[k]}
        onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
      />
    </div>
  );

  return (
    <div className="picker" ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        className={p.active ? 'toolbar-button icon-only is-active' : 'toolbar-button icon-only'}
        aria-label="Date and count filters"
        title="Date and count filters"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          if (!open) setDraft(p.value);
          setOpen(!open);
        }}
      >
        <span className="codicon codicon-filter" aria-hidden="true" />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Date and count filters"
          className="popover date-popover"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              close();
            }
          }}
        >
          <form
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              if (countOk) submit(draft);
            }}
          >
            {field('maxCount', 'Last N commits', 'all')}
            {field('since', 'Since', 'e.g. 2 weeks ago')}
            {field('until', 'Until', 'e.g. 2026-10-01')}
            <div className="form-buttons">
              <button type="button" className="secondary" onClick={() => submit(NO_DATES)}>
                Clear
              </button>
              <button type="submit" disabled={!countOk}>
                Apply
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
