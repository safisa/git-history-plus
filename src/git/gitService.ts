import { createHash } from 'node:crypto';
import type {
  Commit,
  CommitDetails,
  Containing,
  FileChange,
  Hash,
  LogPage,
  LogQuery,
  Person,
  Ref,
} from '../shared/types';
import { WORKTREE } from '../shared/types';
import { GitError, runGit, runGitBuffer, type RunGitOptions } from './exec';
import { mergeStats, parseFollowLog, parseNameStatus, parseNumstat, type FileVersion } from './diffParser';
import { computeGraph, computeTimeline } from './graph';
import { LOG_FORMAT, buildLogArgs } from './logArgs';
import { parseLog, type RawCommit } from './logParser';
import { REFS_FORMAT, parseRefs } from './refs';

const HASH_LIKE = /^[0-9a-f]{4,64}$/i;
/** log.showSignature=true would print signature lines into output we parse. */
const NO_SIGNATURE = ['-c', 'log.showSignature=false'];
/**
 * `git status` for the state fingerprint: never takes the index lock (it would wake every index
 * watcher, vscode.git's too), and lists an untracked folder once rather than every file in it.
 */
const STATUS = ['--no-optional-locks', 'status', '--porcelain=v1', '-z', '--untracked-files=normal'];

/** The uncommitted changes row: a pseudo commit on top of HEAD. */
export function worktreeCommit(head: Hash | undefined, files: number, now = Date.now()): Commit {
  const nobody = { name: '', email: '' };
  return {
    hash: WORKTREE,
    parents: head ? [head] : [],
    author: nobody,
    authorDate: now,
    committer: nobody,
    commitDate: now,
    subject: `Uncommitted changes (${files} file${files === 1 ? '' : 's'})`,
    body: '',
    refs: [],
  };
}

/** The uncommitted row belongs on page one of an unfiltered (or path-only) log that includes HEAD. */
const showsWorktree = (q: LogQuery) =>
  q.skip === 0 &&
  !q.graphCarry &&
  q.branch.kind !== 'ref' &&
  !q.text &&
  !q.author &&
  !q.lines &&
  !q.since &&
  !q.until;

/** At most this many branch and tag names come back from `containing` (the counts are complete). */
const CONTAINING_MAX = 50;
const EMPTY_CARRY = (): LogPage['carry'] => ({ lanes: [], colors: [], nextColor: 0 });

/** `rev-parse --verify --quiet` exits 1 for a missing or unborn revision; other codes are real failures. */
function isMissingRev(e: unknown): boolean {
  return e instanceof GitError && e.exitCode === 1;
}

export class GitService {
  private refsCache: Promise<Ref[]> | undefined;
  /** File-history path chains by path; dropped by invalidate() (every refresh). */
  private readonly versionsCache = new Map<string, Promise<FileVersion[]>>();

  constructor(
    readonly root: string,
    private readonly gitPath: string,
  ) {}

  run(args: string[], opts?: RunGitOptions): Promise<string> {
    return runGit(this.gitPath, this.root, args, opts);
  }

  invalidate(): void {
    this.refsCache = undefined;
    this.versionsCache.clear();
  }

  /**
   * Changes exactly when what a history view shows can change: the HEAD commit, any ref, which
   * branch is checked out, or which files have uncommitted changes (the uncommitted row). Editing a
   * file that is already changed leaves it unchanged.
   */
  async stateFingerprint(): Promise<string> {
    const [head, refs, status] = await Promise.all([
      this.run(['rev-parse', '--verify', '--quiet', 'HEAD']).catch((e: unknown) => {
        if (isMissingRev(e)) return 'unborn';
        throw e;
      }),
      this.run(['for-each-ref', '--format=%(objectname) %(refname) %(HEAD)']),
      // A status that fails (a broken submodule, say) must not read as a change on every event.
      this.run(STATUS).catch(() => 'status-error'),
    ]);
    const digest = (s: string) => createHash('sha1').update(s).digest('hex');
    return `${head.trim()} ${digest(refs)} ${digest(status)}`;
  }

  /**
   * The uncommitted changes (under `path` if given): HEAD against the working tree, untracked files
   * as added. The row's file count and its details both come from here, so they always agree.
   * `stats: false` skips the line counts (--numstat), for callers that only need the files.
   */
  async worktreeFiles(path?: string, opts: { stats?: boolean } = {}): Promise<FileChange[]> {
    const base = ['--no-optional-locks', 'diff', '-z', '-M', '--no-color'];
    const spec = ['--', ...(path ? [path] : [])];
    const withStats = opts.stats !== false;
    const [names, stats, untracked] = await Promise.all([
      this.run([...base, '--name-status', '--end-of-options', 'HEAD', ...spec]),
      withStats ? this.run([...base, '--numstat', '--end-of-options', 'HEAD', ...spec]) : '',
      this.run(['--no-optional-locks', 'ls-files', '--others', '--exclude-standard', '-z', ...spec]),
    ]);
    const changes = parseNameStatus(names);
    const files = withStats ? mergeStats(changes, parseNumstat(stats)) : changes;
    for (const path of untracked.split('\0')) if (path) files.push({ status: 'A', path });
    return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }

  refs(): Promise<Ref[]> {
    if (!this.refsCache) {
      const p = this.run(['for-each-ref', `--format=${REFS_FORMAT}`]).then(parseRefs);
      p.catch(() => {
        if (this.refsCache === p) this.refsCache = undefined;
      });
      this.refsCache = p;
    }
    return this.refsCache;
  }

  async resolveCommit(rev: string): Promise<Hash | undefined> {
    try {
      const out = await this.run(['rev-parse', '--verify', '--quiet', '--end-of-options', `${rev}^{commit}`]);
      return out.trim() || undefined;
    } catch (e) {
      if (isMissingRev(e)) return undefined;
      throw e;
    }
  }

  private async attachRefs(raw: RawCommit[]): Promise<Commit[]> {
    const byTarget = new Map<Hash, Ref[]>();
    for (const r of await this.refs()) {
      const list = byTarget.get(r.target);
      if (list) list.push(r);
      else byTarget.set(r.target, [r]);
    }
    return raw.map((c) => ({ ...c, refs: byTarget.get(c.hash) ?? [] }));
  }

  private async loadCommit(hash: Hash): Promise<Commit> {
    const out = await this.run([
      ...NO_SIGNATURE,
      'log',
      '-z',
      '--no-color',
      '--use-mailmap',
      `--format=${LOG_FORMAT}`,
      '-n1',
      '--end-of-options',
      hash,
    ]);
    const [raw] = parseLog(out);
    if (!raw) throw new Error(`Commit ${hash} could not be read from git log output`);
    const [commit] = await this.attachRefs([raw]);
    return commit as Commit;
  }

  /** HEAD's commit, or null while HEAD is unborn (a repository without commits). */
  private async headOrUnborn(): Promise<Hash | null> {
    try {
      return (await this.run(['rev-parse', '--verify', '--quiet', 'HEAD'])).trim();
    } catch (e) {
      if (isMissingRev(e)) return null;
      throw e;
    }
  }

  async log(q: LogQuery, includeRemotes: boolean): Promise<LogPage> {
    const empty = (): LogPage => ({ commits: [], graph: [], carry: EMPTY_CARRY(), hasMore: false });
    // HEAD is only needed for the unborn check and the uncommitted row; a picked ref needs neither.
    const headP = q.branch.kind === 'ref' ? Promise.resolve(undefined) : this.headOrUnborn();

    if (q.text && HASH_LIKE.test(q.text)) {
      if ((await headP) === null) return empty();
      const full = await this.resolveCommit(q.text);
      if (full) {
        const commit = await this.loadCommit(full);
        const g = computeTimeline([commit], undefined, false);
        return { commits: [commit], graph: g.rows, carry: g.carry, hasMore: false, exactHash: full };
      }
    }

    // The independent git calls start together, so the slowest one (usually the untracked-file scan
    // behind the uncommitted row) sets the page's latency instead of the sum of all of them.
    const args = buildLogArgs(q, { includeRemotes });
    args.splice(args.indexOf('log') + 1, 0, '--no-color');
    const outP = this.run(args);
    const refsP = this.refs();
    // On top, uncommitted changes (under the path, in file and folder history) as a pseudo commit.
    // Only their count is needed here, so no --numstat (the details compute that). A failure here
    // (a broken submodule, say) only costs the row, never the history.
    const changedP = showsWorktree(q)
      ? this.worktreeFiles(q.path, { stats: false }).then(
          (files) => files.length,
          () => 0,
        )
      : Promise.resolve(0);
    // What an early return below abandons must not surface as an unhandled rejection.
    outP.catch(() => undefined);
    refsP.catch(() => undefined);

    const head = await headP;
    if (head === null) return empty(); // `git log HEAD` fails on an unborn HEAD; dropped above
    const out = await outP;
    const parsed = parseLog(out);
    if (out.trim() !== '' && parsed.length === 0) {
      throw new Error('git log produced output that could not be parsed into commits');
    }
    const hasMore =
      parsed.length > q.pageSize && (q.maxCount === undefined || q.skip + q.pageSize < q.maxCount);
    const commits = await this.attachRefs(parsed.slice(0, q.pageSize));
    const changed = head ? await changedP : 0;
    if (changed > 0) commits.unshift(worktreeCommit(head, changed));
    // A filtered list hides the commits between its rows, so lanes can't be drawn: use a timeline.
    const filtered = !!(q.path || q.lines || q.text || q.author);
    const g = filtered
      ? computeTimeline(commits, q.graphCarry, hasMore)
      : computeGraph(commits, q.graphCarry);
    return { commits, graph: g.rows, carry: g.carry, hasMore };
  }

  /**
   * The configured `user.name` / `user.email` as `.mailmap` maps them (the author filter matches the
   * mapped identity); undefined without an email.
   */
  async currentUser(): Promise<Person | undefined> {
    const get = (key: string) =>
      this.run(['config', '--get', key]).then(
        (out) => out.trim(),
        (e: unknown) => {
          if (isMissingRev(e)) return ''; // exit 1: not set
          throw e;
        },
      );
    const [name, email] = await Promise.all([get('user.name'), get('user.email')]);
    if (!email) return undefined;
    // On stdin, so nothing from the config can be read as an option.
    const mapped = await this.run(['check-mailmap', '--stdin'], { input: `${name} <${email}>\n` });
    const m = /^(.*?) ?<([^>]*)>\s*$/.exec(mapped);
    return m ? { name: m[1] ?? name, email: m[2] || email } : { name, email };
  }

  async authors(): Promise<Person[]> {
    const out = await this.run(['shortlog', '-sne', '--all']);
    const people: Person[] = [];
    for (const line of out.split('\n')) {
      const m = /^\s*\d+\t(.*) <(.*)>$/.exec(line);
      if (m) people.push({ name: m[1] ?? '', email: m[2] ?? '' });
    }
    return people;
  }

  /** `path` scopes the uncommitted changes (file and folder history); commits ignore it. */
  async details(hash: Hash, path?: string): Promise<CommitDetails> {
    if (hash === WORKTREE) {
      const [head, files] = await Promise.all([this.resolveCommit('HEAD'), this.worktreeFiles(path)]);
      return { commit: worktreeCommit(head, files.length), files };
    }
    const commit = await this.loadCommit(hash);
    const parent = commit.parents[0];
    if (parent) return { commit, files: await this.diffFiles(parent, commit.hash) };
    const base = ['diff-tree', '--root', '-r', '-z', '-M', '--no-commit-id', '--no-color'];
    const [names, stats] = await Promise.all([
      this.run([...base, '--name-status', '--end-of-options', commit.hash]),
      this.run([...base, '--numstat', '--end-of-options', commit.hash]),
    ]);
    return { commit, files: mergeStats(parseNameStatus(names), parseNumstat(stats)) };
  }

  /** The branches (local, then remote) and tags whose history includes `hash`. */
  async containing(hash: Hash): Promise<Containing> {
    const out = await this.run([
      'for-each-ref',
      `--contains=${hash}`,
      '--format=%(refname)',
      'refs/heads',
      'refs/remotes',
      'refs/tags',
    ]);
    const branches: string[] = [];
    const tags: string[] = [];
    for (const ref of out.split('\n')) {
      if (ref.startsWith('refs/heads/')) branches.push(ref.slice('refs/heads/'.length));
      else if (ref.startsWith('refs/remotes/') && !ref.endsWith('/HEAD'))
        branches.push(ref.slice('refs/remotes/'.length));
      else if (ref.startsWith('refs/tags/')) tags.push(ref.slice('refs/tags/'.length));
    }
    return {
      branches: branches.slice(0, CONTAINING_MAX),
      tags: tags.slice(0, CONTAINING_MAX),
      branchCount: branches.length,
      tagCount: tags.length,
    };
  }

  async diffFiles(from: Hash, to: Hash): Promise<FileChange[]> {
    const base = ['diff', '-z', '-M', '--no-color'];
    const [names, stats] = await Promise.all([
      this.run([...base, '--name-status', '--end-of-options', from, to]),
      this.run([...base, '--numstat', '--end-of-options', from, to]),
    ]);
    return mergeStats(parseNameStatus(names), parseNumstat(stats));
  }

  async show(ref: Hash, path: string): Promise<Buffer> {
    try {
      return await runGitBuffer(this.gitPath, this.root, [
        'show',
        '--no-color',
        '--end-of-options',
        `${ref}:${path}`,
      ]);
    } catch (e) {
      if (e instanceof GitError && /does not exist in|exists on disk, but not in/.test(e.stderr)) {
        return Buffer.alloc(0);
      }
      throw e;
    }
  }

  /** The commits of `path`'s history, newest first, following renames. */
  async fileHistory(path: string): Promise<Hash[]> {
    return (await this.fileVersions(path)).map((v) => v.hash);
  }

  /**
   * `path`'s history (newest first, following renames) with each commit's status and paths, from a
   * single `git log`, cached until invalidate().
   */
  fileVersions(path: string): Promise<FileVersion[]> {
    let p = this.versionsCache.get(path);
    if (!p) {
      p = this.run([
        ...NO_SIGNATURE,
        'log',
        '--no-color',
        '--follow',
        '--name-status',
        '-z',
        '--format=%H',
        '--end-of-options',
        'HEAD',
        '--',
        path,
      ]).then((out) => parseFollowLog(out, path));
      const cached = p;
      p.catch(() => {
        if (this.versionsCache.get(path) === cached) this.versionsCache.delete(path);
      });
      this.versionsCache.set(path, p);
    }
    return p;
  }
}
