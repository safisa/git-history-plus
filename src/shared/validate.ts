import {
  COLUMN_MAX_WIDTH,
  COLUMN_MIN_WIDTH,
  COLUMNS,
  PANEL_MAX_WIDTH,
  PANEL_MIN_WIDTH,
  type Request,
  type ViewLayout,
} from './protocol';
import type {
  BranchFilter,
  ChangeStatus,
  CommitAction,
  FileChange,
  GraphCarry,
  Hash,
  LogQuery,
} from './types';

// Security boundary: everything arriving from the webview passes through here.
// validateRequest rebuilds a fresh object so later mutation of the input cannot bypass checks.

const HASH_RE = /^[0-9a-f]{4,64}$/;
// eslint-disable-next-line no-control-regex
const BAD_REF_CHARS = /[\x00-\x20\x7f~^:?*[\\]/;

export function isHash(s: unknown): s is Hash {
  return typeof s === 'string' && HASH_RE.test(s);
}

export function isSafeRefName(s: unknown): s is string {
  if (typeof s !== 'string' || s.length === 0 || s.length > 255) return false;
  if (s.startsWith('-')) return false;
  if (s.includes('..') || s.includes('@{') || s.includes('//')) return false;
  if (s.endsWith('/') || s.endsWith('.') || s.endsWith('.lock')) return false;
  return !BAD_REF_CHARS.test(s);
}

const ACTIONS: ReadonlySet<string> = new Set<CommitAction>([
  'checkout',
  'cherryPick',
  'revert',
  'merge',
  'rebase',
  'resetSoft',
  'resetHard',
  'createBranch',
  'createTag',
  'removeTag',
  'removeBranch',
  'removeRemoteBranch',
]);
const STATUSES: ReadonlySet<string> = new Set<ChangeStatus>(['A', 'M', 'D', 'R', 'C', 'T', 'U']);
const QUERY_KEYS: ReadonlySet<string> = new Set([
  'branch',
  'text',
  'author',
  'path',
  'follow',
  'lines',
  'since',
  'until',
  'maxCount',
  'skip',
  'pageSize',
  'graphCarry',
]);
const MAX_FIELD = 1000;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isNonNegInt = (v: unknown): v is number => isInt(v) && v >= 0;
const hasOnly = (o: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(o).every((k) => keys.includes(k));
const isPath = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && !v.includes('\0');
/**
 * A path the webview asks to open in the work tree or at a commit: repo-relative, so never absolute
 * (`/x`, `\\host`, `C:`) and never with a `..` segment that could step out of the repository.
 */
const isRepoPath = (v: unknown): v is string =>
  isPath(v) && !/^[\\/]/.test(v) && !/^[A-Za-z]:/.test(v) && !v.split(/[\\/]/).includes('..');
/** An absolute http(s) URL of sane length: the only links the view may ask to open. */
export function isWebUrl(v: unknown): v is string {
  if (typeof v !== 'string' || v.length > 2048) return false;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}
const isField = (v: unknown): v is string =>
  typeof v === 'string' && v.length <= MAX_FIELD && !v.includes('\0');

function validateFile(v: unknown): FileChange | undefined {
  if (!isObj(v)) return undefined;
  if (!hasOnly(v, ['status', 'path', 'oldPath', 'additions', 'deletions', 'binary'])) return undefined;
  if (typeof v.status !== 'string' || !STATUSES.has(v.status) || !isRepoPath(v.path)) return undefined;
  const out: FileChange = { status: v.status as ChangeStatus, path: v.path };
  if (v.oldPath !== undefined) {
    if (!isRepoPath(v.oldPath)) return undefined;
    out.oldPath = v.oldPath;
  }
  for (const k of ['additions', 'deletions'] as const) {
    if (v[k] !== undefined) {
      if (typeof v[k] !== 'number' || !Number.isFinite(v[k]) || (v[k] as number) < 0) return undefined;
      out[k] = v[k] as number;
    }
  }
  if (v.binary !== undefined) {
    if (typeof v.binary !== 'boolean') return undefined;
    out.binary = v.binary;
  }
  return out;
}

function validateBranch(v: unknown): BranchFilter | undefined {
  if (!isObj(v)) return undefined;
  if (v.kind === 'current' || v.kind === 'all') return hasOnly(v, ['kind']) ? { kind: v.kind } : undefined;
  if (v.kind === 'ref' && hasOnly(v, ['kind', 'ref']) && isSafeRefName(v.ref))
    return { kind: 'ref', ref: v.ref };
  return undefined;
}

function validateCarry(v: unknown): GraphCarry | undefined {
  if (!isObj(v) || !hasOnly(v, ['lanes', 'colors', 'nextColor'])) return undefined;
  const { lanes, colors, nextColor } = v;
  if (
    !Array.isArray(lanes) ||
    lanes.length > 1000 ||
    !Array.isArray(colors) ||
    colors.length !== lanes.length
  )
    return undefined;
  if (!isNonNegInt(nextColor)) return undefined;
  const outLanes: (Hash | null)[] = [];
  for (const l of lanes) {
    if (l !== null && !isHash(l)) return undefined;
    outLanes.push(l);
  }
  const outColors: number[] = [];
  for (const c of colors) {
    if (!isNonNegInt(c)) return undefined;
    outColors.push(c);
  }
  return { lanes: outLanes, colors: outColors, nextColor };
}

function validateQuery(v: unknown): LogQuery | undefined {
  if (!isObj(v)) return undefined;
  if (!Object.keys(v).every((k) => QUERY_KEYS.has(k))) return undefined;
  const branch = validateBranch(v.branch);
  if (!branch || !isNonNegInt(v.skip) || !isInt(v.pageSize) || v.pageSize < 1 || v.pageSize > 1000)
    return undefined;
  const out: LogQuery = { branch, skip: v.skip, pageSize: v.pageSize };
  for (const k of ['text', 'author', 'path', 'since', 'until'] as const) {
    if (v[k] !== undefined) {
      if (!isField(v[k])) return undefined;
      out[k] = v[k];
    }
  }
  if (v.follow !== undefined) {
    if (typeof v.follow !== 'boolean') return undefined;
    out.follow = v.follow;
  }
  if (v.lines !== undefined) {
    const l = v.lines;
    if (!isObj(l) || !hasOnly(l, ['path', 'start', 'end']) || !isPath(l.path)) return undefined;
    if (!isInt(l.start) || !isInt(l.end) || l.start < 1 || l.start > l.end) return undefined;
    out.lines = { path: l.path, start: l.start, end: l.end };
  }
  if (v.maxCount !== undefined) {
    if (!isNonNegInt(v.maxCount)) return undefined;
    out.maxCount = v.maxCount;
  }
  if (v.graphCarry !== undefined) {
    const gc = validateCarry(v.graphCarry);
    if (!gc) return undefined;
    out.graphCarry = gc;
  }
  return out;
}

const inRange = (v: unknown, min: number, max: number): v is number => isInt(v) && v >= min && v <= max;

/**
 * The well-formed fields of a layout (from the webview or from stored state); anything else is
 * dropped. Undefined when `v` is not an object.
 */
export function sanitizeLayout(v: unknown): ViewLayout | undefined {
  if (!isObj(v)) return undefined;
  const out: ViewLayout = {};
  if (inRange(v.panelWidth, PANEL_MIN_WIDTH, PANEL_MAX_WIDTH)) out.panelWidth = v.panelWidth;
  if (isObj(v.columns)) {
    const columns: ViewLayout['columns'] = {};
    for (const c of COLUMNS) {
      const w = v.columns[c];
      if (inRange(w, COLUMN_MIN_WIDTH, COLUMN_MAX_WIDTH)) columns[c] = w;
    }
    if (Object.keys(columns).length > 0) out.columns = columns;
  }
  if (typeof v.fileTree === 'boolean') out.fileTree = v.fileTree;
  return out;
}

export function validateRequest(msg: unknown): Request | undefined {
  if (!isObj(msg) || !isInt(msg.id)) return undefined;
  const id = msg.id;
  switch (msg.type) {
    case 'refs':
    case 'authors':
    case 'compareRefs':
    case 'refreshRepo':
    case 'fetch':
    case 'me':
    case 'head':
      return { id, type: msg.type };
    case 'openExternal':
      return isWebUrl(msg.url) ? { id, type: 'openExternal', url: msg.url } : undefined;
    case 'saveLayout': {
      const layout = sanitizeLayout(msg.layout);
      return layout && Object.keys(layout).length > 0 ? { id, type: 'saveLayout', layout } : undefined;
    }
    case 'details':
      if (msg.path !== undefined && !isField(msg.path)) return undefined;
      return isHash(msg.hash)
        ? { id, type: 'details', hash: msg.hash, ...(msg.path === undefined ? {} : { path: msg.path }) }
        : undefined;
    case 'containing':
    case 'selectForComparison':
    case 'compareWithSelected':
    case 'showInCommitView':
    case 'openVersionDiff':
      return isHash(msg.hash) ? { id, type: msg.type, hash: msg.hash } : undefined;
    case 'log': {
      const query = validateQuery(msg.query);
      return query ? { id, type: 'log', query } : undefined;
    }
    case 'openDiff': {
      const file = validateFile(msg.file);
      if (!isHash(msg.hash) || !file) return undefined;
      if (msg.pinned !== undefined && typeof msg.pinned !== 'boolean') return undefined;
      return { id, type: 'openDiff', hash: msg.hash, file, ...(msg.pinned ? { pinned: true } : {}) };
    }
    case 'openFileAt':
    case 'compareWithWorkspace':
      return isHash(msg.hash) && isRepoPath(msg.path)
        ? { id, type: msg.type, hash: msg.hash, path: msg.path }
        : undefined;
    case 'action': {
      if (typeof msg.action !== 'string' || !ACTIONS.has(msg.action) || !isHash(msg.hash)) return undefined;
      const action = msg.action as CommitAction;
      if (msg.ref === undefined) return { id, type: 'action', action, hash: msg.hash };
      return isSafeRefName(msg.ref)
        ? { id, type: 'action', action, hash: msg.hash, ref: msg.ref }
        : undefined;
    }
    case 'copy':
      return typeof msg.text === 'string' && msg.text.length <= 10_000
        ? { id, type: 'copy', text: msg.text }
        : undefined;
    case 'avatars': {
      const e = msg.emails;
      if (!Array.isArray(e) || e.length > 200) return undefined;
      if (!e.every((x) => typeof x === 'string' && x.length <= 254)) return undefined;
      return { id, type: 'avatars', emails: [...e] };
    }
    default:
      return undefined;
  }
}
