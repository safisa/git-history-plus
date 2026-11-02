import type { CommitAction, Hash, Ref } from '../src/shared/types';

export interface MenuItem {
  label: string;
  icon?: string;
  disabled?: boolean;
  onSelect(): void;
}
/** A menu entry; `'-'` draws a separator. */
export type MenuEntry = MenuItem | '-';

export interface ActionDef {
  action: CommitAction;
  label: string;
  icon: string;
}

/**
 * Commit-level actions, in menu order. Destructive ones are confirmed natively by
 * the extension, so the webview only sends the request.
 */
export const COMMIT_ACTIONS: readonly ActionDef[] = [
  { action: 'checkout', label: 'Checkout', icon: 'check' },
  { action: 'cherryPick', label: 'Cherry-pick', icon: 'git-commit' },
  { action: 'revert', label: 'Revert', icon: 'discard' },
  { action: 'merge', label: 'Merge', icon: 'git-merge' },
  { action: 'rebase', label: 'Rebase', icon: 'git-pull-request' },
  { action: 'resetSoft', label: 'Reset (soft)', icon: 'history' },
  { action: 'resetHard', label: 'Reset (hard)', icon: 'warning' },
  { action: 'createBranch', label: 'Create branch…', icon: 'git-branch' },
  { action: 'createTag', label: 'Create tag…', icon: 'tag' },
];

/** Ref-specific actions shown on a badge's menu; empty for the checked-out branch. */
export function refActions(ref: Ref): ActionDef[] {
  if ((ref.kind === 'branch' || ref.kind === 'head') && ref.current) return [];
  const common: ActionDef[] = [
    { action: 'checkout', label: 'Checkout', icon: 'check' },
    { action: 'merge', label: 'Merge into current branch', icon: 'git-merge' },
  ];
  switch (ref.kind) {
    case 'branch':
    case 'head':
      return [
        ...common,
        { action: 'rebase', label: 'Rebase current branch onto this', icon: 'git-pull-request' },
        { action: 'removeBranch', label: 'Remove branch', icon: 'trash' },
      ];
    case 'remote':
      return [
        ...common,
        { action: 'rebase', label: 'Rebase current branch onto this', icon: 'git-pull-request' },
        { action: 'removeRemoteBranch', label: 'Delete remote branch', icon: 'trash' },
      ];
    case 'tag':
      return [...common, { action: 'removeTag', label: 'Remove tag', icon: 'trash' }];
  }
}

export interface CommitMenuDeps {
  hash: Hash;
  comparisonBase?: Hash;
  runAction(action: CommitAction, ref?: string): void;
  copyHash(): void;
  selectForComparison(): void;
  compareWithSelected(): void;
  showInExplorer(): void;
  /** File and line history only: open this version's diff. */
  openChanges?(): void;
}

/** The commit context menu: the row's right-click / Shift+F10 menu and the details "…" button. */
export function commitMenu(d: CommitMenuDeps): MenuEntry[] {
  const entries: MenuEntry[] = [
    ...(d.openChanges
      ? [{ label: 'Open Changes', icon: 'diff', onSelect: d.openChanges }, '-' as const]
      : []),
    { label: 'Copy commit hash', icon: 'copy', onSelect: d.copyHash },
    '-',
    ...COMMIT_ACTIONS.map((a) => ({ label: a.label, icon: a.icon, onSelect: () => d.runAction(a.action) })),
    '-',
    { label: 'Select for comparison', icon: 'target', onSelect: d.selectForComparison },
  ];
  if (d.comparisonBase !== undefined && d.comparisonBase !== d.hash)
    entries.push({ label: 'Compare with selected', icon: 'git-compare', onSelect: d.compareWithSelected });
  entries.push({ label: 'Show in Explorer', icon: 'list-tree', onSelect: d.showInExplorer });
  return entries;
}
