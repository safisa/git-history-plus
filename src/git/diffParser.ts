import type { ChangeStatus, FileChange, Hash } from '../shared/types';

const STATUSES = new Set<string>(['A', 'M', 'D', 'R', 'C', 'T', 'U']);

/** Parses `--name-status -z` output. R/C entries carry `oldPath`; score digits are dropped. */
export function parseNameStatus(raw: string): FileChange[] {
  const tokens = raw.split('\0');
  const files: FileChange[] = [];
  let i = 0;
  while (i < tokens.length) {
    const code = tokens[i++] ?? '';
    if (code === '') continue;
    const letter = code[0] ?? '';
    const status: ChangeStatus = STATUSES.has(letter) ? (letter as ChangeStatus) : 'U';
    if (letter === 'R' || letter === 'C') {
      const oldPath = tokens[i++] ?? '';
      const path = tokens[i++] ?? '';
      files.push({ status, path, oldPath });
    } else {
      files.push({ status, path: tokens[i++] ?? '' });
    }
  }
  return files;
}

export type NumstatMap = Map<string, { additions?: number; deletions?: number; binary: boolean }>;

/** Parses `--numstat -z` output, keyed by (new) path. Binary files report `-\t-`. */
export function parseNumstat(raw: string): NumstatMap {
  const map: NumstatMap = new Map();
  const tokens = raw.split('\0');
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i++] ?? '';
    if (token === '') continue;
    const first = token.indexOf('\t');
    const second = token.indexOf('\t', first + 1);
    if (first < 0 || second < 0) continue;
    const adds = token.slice(0, first);
    const dels = token.slice(first + 1, second);
    let path = token.slice(second + 1);
    if (path === '') {
      i++; // old path of a rename/copy
      path = tokens[i++] ?? '';
    }
    if (adds === '-' && dels === '-') map.set(path, { binary: true });
    else map.set(path, { additions: Number(adds), deletions: Number(dels), binary: false });
  }
  return map;
}

export function mergeStats(files: FileChange[], stats: NumstatMap): FileChange[] {
  return files.map((f) => {
    const s = stats.get(f.path);
    if (!s) return f;
    return s.binary
      ? { ...f, binary: true }
      : { ...f, additions: s.additions, deletions: s.deletions, binary: false };
  });
}

/** One version of a followed file: the commit and how it touched the file (path as of that commit). */
export interface FileVersion {
  hash: Hash;
  status: ChangeStatus;
  path: string;
  /** The path in the commit's parent, for a rename or copy. */
  oldPath?: string;
}

const COMMIT_HASH = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const STATUS_CODE = /^[ACDMRTUX]\d*$/;

/**
 * Parses `log --follow --name-status -z --format=%H -- <path>` (newest first): each commit is
 * `<hash>\0\n<status>\0<path>\0` (R/C: `<old>\0<new>\0`). A commit with no file line (e.g. a merge)
 * keeps the path the newer version came from, as a modification.
 */
export function parseFollowLog(raw: string, path: string): FileVersion[] {
  const tokens = raw.split('\0');
  const versions: FileVersion[] = [];
  let expected = path;
  let current: FileVersion | undefined;
  let seenFile = false;
  const finish = () => {
    if (!current) return;
    versions.push(current);
    expected = current.oldPath ?? current.path;
  };
  let i = 0;
  while (i < tokens.length) {
    const token = (tokens[i++] ?? '').replace(/^\n+/, '');
    if (token === '') continue;
    if (current && STATUS_CODE.test(token)) {
      const letter = token[0]!;
      const status: ChangeStatus = STATUSES.has(letter) ? (letter as ChangeStatus) : 'U';
      const twoPaths = letter === 'R' || letter === 'C';
      const oldPath = twoPaths ? (tokens[i++] ?? '') : undefined;
      const newPath = tokens[i++] ?? '';
      // --follow shows only the followed file; prefer the line for the expected path if there are more.
      if (!seenFile || newPath === expected) {
        current.status = status;
        current.path = newPath;
        if (oldPath === undefined) delete current.oldPath;
        else current.oldPath = oldPath;
        seenFile = true;
      }
    } else if (COMMIT_HASH.test(token)) {
      finish();
      current = { hash: token, status: 'M', path: expected };
      seenFile = false;
    }
  }
  finish();
  return versions;
}
