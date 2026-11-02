import * as vscode from 'vscode';
import { NS } from './constants';
import type { LogLevel } from './logger';
import type { IssueLink } from './shared/protocol';

export interface Settings {
  alwaysPromptRepositoryPicker: boolean;
  includeRemoteBranches: boolean;
  showEditorTitleMenuBarIcons: boolean;
  editorTitleButtonOpenRepo: boolean;
  pageSize: number;
  hideCommitViewExplorer: boolean;
  hideCompareCommitViewExplorer: boolean;
  logLevel: LogLevel;
  sourceCodeProviderIntegrationLocation: 'Inline' | 'More Actions';
  dateFormat: string;
  avatars: 'off' | 'github' | 'gravatar';
  defaultMaxCount: number;
  issueLinks: IssueLink[];
  dimMergeCommits: boolean;
  showStatusBarItem: boolean;
}

const MAX_ISSUE_LINKS = 20;
const MAX_ISSUE_FIELD = 500;

/** Well-formed `issueLinks` entries only (the view still drops patterns that don't compile). */
function issueLinks(v: unknown): IssueLink[] {
  if (!Array.isArray(v)) return [];
  const ok = (s: unknown): s is string => typeof s === 'string' && s !== '' && s.length <= MAX_ISSUE_FIELD;
  return v
    .filter((e): e is IssueLink => typeof e === 'object' && e !== null && ok(e.pattern) && ok(e.url))
    .slice(0, MAX_ISSUE_LINKS)
    .map((e) => ({ pattern: e.pattern, url: e.url }));
}

/** The largest page the webview may request (validateRequest rejects more). */
export const MAX_PAGE_SIZE = 1000;

export function getConfig(): Settings {
  const c = vscode.workspace.getConfiguration(NS);
  /** An integer setting clamped to [min, max]; a non-number falls back to the default. */
  const int = (key: string, def: number, min: number, max = Number.MAX_SAFE_INTEGER): number => {
    const v = c.get<number>(key, def);
    if (typeof v !== 'number' || !Number.isFinite(v)) return def;
    return Math.min(max, Math.max(min, Math.floor(v)));
  };
  const level = c.get<string>('logLevel', 'Info');
  const location = c.get<string>('sourceCodeProviderIntegrationLocation', 'Inline');
  const avatars = c.get<string>('avatars', 'off');
  return {
    alwaysPromptRepositoryPicker: c.get<boolean>('alwaysPromptRepositoryPicker', false) ?? false,
    includeRemoteBranches: c.get<boolean>('includeRemoteBranches', false) ?? false,
    showEditorTitleMenuBarIcons: c.get<boolean>('showEditorTitleMenuBarIcons', true) ?? true,
    editorTitleButtonOpenRepo: c.get<boolean>('editorTitleButtonOpenRepo', false) ?? false,
    pageSize: int('pageSize', 100, 1, MAX_PAGE_SIZE),
    hideCommitViewExplorer: c.get<boolean>('hideCommitViewExplorer', false) ?? false,
    hideCompareCommitViewExplorer: c.get<boolean>('hideCompareCommitViewExplorer', false) ?? false,
    logLevel: level === 'None' || level === 'Debug' ? level : 'Info',
    sourceCodeProviderIntegrationLocation: location === 'More Actions' ? 'More Actions' : 'Inline',
    dateFormat: c.get<string>('dateFormat', 'relative') || 'relative',
    avatars: avatars === 'github' || avatars === 'gravatar' ? avatars : 'off',
    defaultMaxCount: int('defaultMaxCount', 0, 0),
    issueLinks: issueLinks(c.get<unknown>('issueLinks', [])),
    dimMergeCommits: c.get<boolean>('dimMergeCommits', true) ?? true,
    showStatusBarItem: c.get<boolean>('showStatusBarItem', true) ?? true,
  };
}
