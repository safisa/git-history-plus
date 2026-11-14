import { useState } from 'react';
import type { Containing } from '../../src/shared/types';

/** A group shows this many names until "Show all". */
export const GROUP_PREVIEW = 5;

interface Group {
  key: 'local' | 'remote' | 'tags';
  title: string;
  icon: string;
  names: string[];
  count: number;
}

const groups = (c: Containing): Group[] =>
  (
    [
      { key: 'local', title: 'Local', icon: 'git-branch', names: c.branches, count: c.branchCount },
      { key: 'remote', title: 'Remote', icon: 'cloud', names: c.remotes, count: c.remoteCount },
      { key: 'tags', title: 'Tags', icon: 'tag', names: c.tags, count: c.tagCount },
    ] satisfies Group[]
  ).filter((g) => g.count > 0);

/** "3 local · 9 remote · 6 tags", or "None". */
export function containingSummary(c: Containing): string {
  const parts = groups(c).map((g) =>
    g.key === 'tags' ? `${g.count} ${g.count === 1 ? 'tag' : 'tags'}` : `${g.count} ${g.key}`,
  );
  return parts.length ? parts.join(' · ') : 'None';
}

/**
 * The refs that include a commit, one per line in Local / Remote / Tags groups (already sorted by
 * the extension). A long group shows its first few names and a "Show all" link. Render it with a
 * `key` per commit so "Show all" starts folded again for the next one.
 */
export function ContainingList({ containing, id }: { containing: Containing; id?: string }) {
  const [unfolded, setUnfolded] = useState<ReadonlySet<Group['key']>>(new Set());
  return (
    <div className="containing-groups" id={id}>
      {groups(containing).map((g) => {
        const all = unfolded.has(g.key);
        const shown = all ? g.names : g.names.slice(0, GROUP_PREVIEW);
        // The extension lists at most a capped number of names; the count is complete.
        const unlisted = g.count - g.names.length;
        return (
          <section key={g.key} className="containing-group" aria-label={g.title}>
            <div className="containing-group-title">
              {g.title}
              <span className="containing-count">{g.count}</span>
            </div>
            <ul className="containing-list">
              {shown.map((name) => (
                <li key={name} className="containing-item">
                  <span className={`codicon codicon-${g.icon}`} aria-hidden="true" />
                  <span className="containing-name" title={name}>
                    {name}
                  </span>
                </li>
              ))}
            </ul>
            {!all && g.names.length > shown.length ? (
              <button
                type="button"
                className="link-button details-link containing-more"
                onClick={() => setUnfolded(new Set([...unfolded, g.key]))}
              >
                Show all {g.count}
              </button>
            ) : (
              unlisted > 0 && <span className="containing-more">and {unlisted} more not listed</span>
            )}
          </section>
        );
      })}
    </div>
  );
}
