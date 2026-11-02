import { literalPattern } from '../shared/literalPattern';
import type { LogQuery } from '../shared/types';

export const LOG_FORMAT = '%H%x1f%P%x1f%aN%x1f%aE%x1f%at%x1f%cN%x1f%cE%x1f%ct%x1f%B';

export function buildLogArgs(q: LogQuery, opts: { includeRemotes: boolean }): string[] {
  const args = [
    '-c',
    'log.showSignature=false',
    'log',
    '-z',
    '--use-mailmap',
    '--date-order',
    `--format=${LOG_FORMAT}`,
  ];

  args.push(`--skip=${q.skip}`);
  const remaining = q.maxCount === undefined ? Infinity : q.maxCount - q.skip;
  const count = remaining <= 0 ? 0 : Math.min(q.pageSize + 1, remaining);
  args.push(`--max-count=${count}`);

  if (q.branch.kind === 'all') {
    args.push('--branches', '--tags');
    if (opts.includeRemotes) args.push('--remotes');
  }

  if (q.author) args.push(`--author=${q.author}`, '--regexp-ignore-case');
  // Not --fixed-strings: that would make --author literal too and break pattern authors. The text is
  // escaped instead, so it still matches literally.
  if (q.text) args.push(`--grep=${literalPattern(q.text)}`, '--regexp-ignore-case');
  if (q.since) args.push(`--since=${q.since}`);
  if (q.until) args.push(`--until=${q.until}`);

  if (q.lines) {
    args.push(`-L${q.lines.start},${q.lines.end}:${q.lines.path}`, '-s');
  } else if (q.path && q.follow) {
    args.push('--follow');
  }

  if (q.branch.kind === 'ref') args.push('--end-of-options', q.branch.ref);
  else if (q.branch.kind === 'current') args.push('--end-of-options', 'HEAD');

  if (q.path && !q.lines) args.push('--', q.path);
  return args;
}
