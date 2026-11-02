import type { Ref } from '../shared/types';

export const REFS_FORMAT = '%(objectname)%00%(*objectname)%00%(refname)%00%(HEAD)%00%(upstream:remotename)';

/** Parses `for-each-ref --format=REFS_FORMAT` output (one record per line). */
export function parseRefs(raw: string): Ref[] {
  const refs: Ref[] = [];
  for (const line of raw.split('\n')) {
    if (line === '') continue;
    const [objectName = '', peeled = '', fullName = '', head = ''] = line.split('\0');
    const target = peeled || objectName;
    if (fullName.startsWith('refs/heads/')) {
      refs.push({
        kind: 'branch',
        name: fullName.slice('refs/heads/'.length),
        fullName,
        target,
        current: head === '*',
      });
    } else if (fullName.startsWith('refs/remotes/')) {
      const name = fullName.slice('refs/remotes/'.length);
      const slash = name.indexOf('/');
      if (slash < 0 || name.endsWith('/HEAD')) continue; // skip symbolic origin/HEAD
      refs.push({ kind: 'remote', name, fullName, target, current: false, remote: name.slice(0, slash) });
    } else if (fullName.startsWith('refs/tags/')) {
      refs.push({
        kind: 'tag',
        name: fullName.slice('refs/tags/'.length),
        fullName,
        target,
        current: false,
      });
    }
  }
  return refs;
}
