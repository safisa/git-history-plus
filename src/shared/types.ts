export type Hash = string; // 4–64 lowercase hex
/**
 * Stands for the uncommitted changes row: git's null object id, which no commit ever has. Requests
 * that need a real commit refuse it.
 */
export const WORKTREE: Hash = '0'.repeat(40);
export interface Person {
  name: string;
  email: string;
}
export type RefKind = 'head' | 'branch' | 'remote' | 'tag';
export interface Ref {
  kind: RefKind;
  name: string;
  fullName: string;
  target: Hash;
  current: boolean;
  remote?: string;
}
export interface Commit {
  hash: Hash;
  parents: Hash[];
  author: Person;
  authorDate: number /* epoch ms */;
  committer: Person;
  commitDate: number;
  subject: string;
  body: string;
  refs: Ref[];
}
export type ChangeStatus = 'A' | 'M' | 'D' | 'R' | 'C' | 'T' | 'U';
export interface FileChange {
  status: ChangeStatus;
  path: string;
  oldPath?: string;
  additions?: number;
  deletions?: number;
  binary?: boolean;
}
export type BranchFilter = { kind: 'current' } | { kind: 'all' } | { kind: 'ref'; ref: string };
export interface LogQuery {
  branch: BranchFilter;
  text?: string;
  author?: string;
  path?: string;
  follow?: boolean;
  lines?: { path: string; start: number; end: number };
  since?: string;
  until?: string;
  maxCount?: number;
  skip: number;
  pageSize: number;
  graphCarry?: GraphCarry;
}
export interface GraphCarry {
  lanes: (Hash | null)[];
  colors: number[];
  nextColor: number;
}
export interface GraphSegment {
  from: number;
  to: number;
  half: 'top' | 'bottom';
  color: number;
}
export interface GraphRow {
  lane: number;
  color: number;
  segments: GraphSegment[];
}
export interface LogPage {
  commits: Commit[];
  graph: GraphRow[];
  carry: GraphCarry;
  hasMore: boolean;
  exactHash?: Hash;
}
/** The branches and tags whose history includes a commit (lists capped; counts are complete). */
export interface Containing {
  branches: string[];
  tags: string[];
  branchCount: number;
  tagCount: number;
}
export interface CommitDetails {
  commit: Commit;
  files: FileChange[];
  /** In file and line history: the tracked file's path as of this commit (it may have been renamed). */
  focusPath?: string;
}
export type CommitAction =
  | 'checkout'
  | 'cherryPick'
  | 'revert'
  | 'merge'
  | 'rebase'
  | 'resetSoft'
  | 'resetHard'
  | 'createBranch'
  | 'createTag'
  | 'removeTag'
  | 'removeBranch'
  | 'removeRemoteBranch';
