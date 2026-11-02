export const NS = 'gitHistoryPlus';
export const EXT_ID = 'safisa.git-history-plus';
export const SCHEME = 'git-history-plus';

export const VIEW_IDS = {
  commit: 'gitHistoryPlus.commitView',
  compare: 'gitHistoryPlus.compareView',
} as const;
export const CONTEXT_KEYS = {
  hasSelection: 'gitHistoryPlus.hasSelection',
  commitViewVisible: 'gitHistoryPlus.commitView.visible',
  compareViewVisible: 'gitHistoryPlus.compareView.visible',
  inFileHistoryDiff: 'gitHistoryPlus.inFileHistoryDiff',
} as const;
