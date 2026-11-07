import type { CommitAction, FileChange, Hash, LogQuery } from './types';

/** The details side panel's width range in pixels; the view clamps to it and the host validates it. */
export const PANEL_MIN_WIDTH = 240;
export const PANEL_MAX_WIDTH = 600;
/** The commit table's resizable columns and their width range in pixels. */
export type Column = 'author' | 'date' | 'hash';
export const COLUMNS: readonly Column[] = ['author', 'date', 'hash'];
export const COLUMN_MIN_WIDTH = 40;
export const COLUMN_MAX_WIDTH = 400;
/**
 * The most commits one `log` request may ask for with `count` (a refresh reloading what was
 * listed); a longer list is reloaded in several requests.
 */
export const LOG_COUNT_MAX = 5000;

/** View layout the user chose, remembered for every history view (the extension's global state). */
export interface ViewLayout {
  panelWidth?: number;
  columns?: Partial<Record<Column, number>>;
  /** Changed files shown as a folder tree rather than a flat list. */
  fileTree?: boolean;
}

/** Repository, one file (following renames), one folder, or a line range of one file. */
export type HistoryMode = 'repo' | 'file' | 'folder' | 'line';

// Every message carries a numeric id; responses echo it.
export type Request =
  | { id: number; type: 'log'; query: LogQuery; count?: number } // count: at least this many (refresh), else a page
  | { id: number; type: 'details'; hash: Hash; path?: string } // path: scopes uncommitted changes
  | { id: number; type: 'refs' }
  | { id: number; type: 'authors' }
  | { id: number; type: 'openDiff'; hash: Hash; file: FileChange; pinned?: boolean } // vs first parent; a preview tab unless pinned
  | { id: number; type: 'openFileAt'; hash: Hash; path: string }
  | { id: number; type: 'compareWithWorkspace'; hash: Hash; path: string }
  | { id: number; type: 'selectForComparison'; hash: Hash }
  | { id: number; type: 'compareWithSelected'; hash: Hash }
  | { id: number; type: 'action'; action: CommitAction; hash: Hash; ref?: string }
  | { id: number; type: 'compareRefs' }
  | { id: number; type: 'copy'; text: string }
  | { id: number; type: 'avatars'; emails: string[] }
  | { id: number; type: 'refreshRepo' } // drop the repo's caches; the view then reloads itself
  | { id: number; type: 'showInCommitView'; hash: Hash }
  | { id: number; type: 'openVersionDiff'; hash: Hash }
  | { id: number; type: 'fetch' } // all remotes, with prune
  | { id: number; type: 'me' } // the configured git user, if any
  | { id: number; type: 'head' } // HEAD's commit hash, if any
  | { id: number; type: 'openExternal'; url: string } // an http(s) issue link
  | { id: number; type: 'saveLayout'; layout: ViewLayout } // merged into the remembered layout
  | { id: number; type: 'containing'; hash: Hash }; // branches and tags that include the commit
export type Response = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };
// extension -> view, no id
export type Push =
  | {
      type: 'init';
      mode: HistoryMode;
      query: LogQuery;
      settings: ViewSettings;
      repoName: string;
      /** The layout the user last chose, if any. */
      layout?: ViewLayout;
    }
  | { type: 'refresh' }
  | { type: 'settings'; settings: ViewSettings }; // a gitHistoryPlus setting changed
export interface ViewSettings {
  dateFormat: string;
  avatars: 'off' | 'github' | 'gravatar';
  locale: string;
  /** Issue keys to link in commit messages (`gitHistoryPlus.issueLinks`). */
  issueLinks?: IssueLink[];
  /** Show merge commits dimmed (`gitHistoryPlus.dimMergeCommits`). */
  dimMergeCommits?: boolean;
}
export interface IssueLink {
  /** A regular expression matched against commit messages. */
  pattern: string;
  /** The link target: `$0` is the match, `$1`…`$9` its groups. */
  url: string;
}
