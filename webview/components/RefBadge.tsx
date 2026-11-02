import type { MouseEvent } from 'react';
import type { Ref, RefKind } from '../../src/shared/types';

const ICON: Record<RefKind, string> = {
  head: 'git-branch',
  branch: 'git-branch',
  remote: 'cloud',
  tag: 'tag',
};

const RANK: Record<RefKind, number> = { head: 0, branch: 1, remote: 2, tag: 3 };

/** Current branch first, then local branches, remotes and tags; stable within each kind. */
export function sortRefs(refs: Ref[]): Ref[] {
  return [...refs].sort((a, b) => Number(b.current) - Number(a.current) || RANK[a.kind] - RANK[b.kind]);
}

/** A badge's refs: a local branch carries the remote branches of the same name on the same commit. */
export interface RefGroup {
  ref: Ref;
  remotes: Ref[];
}

/** sortRefs, with `origin/main` folded into `main` when both point here (as in a commit row). */
export function groupRefs(refs: Ref[]): RefGroup[] {
  const sorted = sortRefs(refs);
  const locals = new Map<string, RefGroup>();
  const groups: RefGroup[] = [];
  for (const ref of sorted) {
    if (ref.kind === 'head' || ref.kind === 'branch') {
      const g = { ref, remotes: [] };
      locals.set(ref.name, g);
      groups.push(g);
    } else if (ref.kind === 'remote' && ref.remote !== undefined) {
      const local = locals.get(ref.name.slice(ref.remote.length + 1));
      if (local) local.remotes.push(ref);
      else groups.push({ ref, remotes: [] });
    } else {
      groups.push({ ref, remotes: [] });
    }
  }
  return groups;
}

const KIND_NAME: Record<RefKind, string> = {
  head: 'Branch',
  branch: 'Branch',
  remote: 'Remote branch',
  tag: 'Tag',
};

export interface RefBadgeProps {
  gitRef: Ref;
  /** Remote branches of the same name on the same commit, shown inside this badge. */
  remotes?: Ref[];
  /** Mouse-only context menu (badges inside table rows). */
  onContextMenu?(e: MouseEvent): void;
  /** Mouse-only context menu of one of `remotes`. */
  onRemoteContextMenu?(remote: Ref, e: MouseEvent): void;
  /** Makes the badge a button that opens its menu (details panel); `from` gets focus back. */
  onMenu?(at: { x: number; y: number }, from: HTMLElement): void;
  /** Adds a ✕ (remote branches: delete from the remote). */
  onRemove?(): void;
}

/** An inline branch/remote/tag label. The name is a text node; the current branch is bold. */
export function RefBadge({
  gitRef,
  remotes = [],
  onContextMenu,
  onRemoteContextMenu,
  onMenu,
  onRemove,
}: RefBadgeProps) {
  const cls = `ref-badge ref-badge--${gitRef.kind}${gitRef.current ? ' ref-badge--current' : ''}`;
  const content = (
    <>
      <span className={`codicon codicon-${ICON[gitRef.kind]}`} aria-hidden="true" />
      <span className="ref-name">{gitRef.name}</span>
      {remotes.length > 0 && (
        <span className="ref-remotes">
          <span className="codicon codicon-cloud" aria-hidden="true" />
          {remotes.map((r) => (
            <span
              key={r.fullName}
              className="ref-remote"
              onContextMenu={onRemoteContextMenu && ((e) => onRemoteContextMenu(r, e))}
            >
              {r.remote}
            </span>
          ))}
        </span>
      )}
    </>
  );
  if (!onMenu && !onRemove) {
    const title = [gitRef.fullName, ...remotes.map((r) => r.fullName)].join('\n');
    return (
      <span className={cls} title={title} onContextMenu={onContextMenu}>
        {content}
      </span>
    );
  }
  return (
    <span className={`${cls} is-interactive`} title={gitRef.fullName}>
      {onMenu ? (
        <button
          type="button"
          className="ref-badge-main"
          aria-label={`${KIND_NAME[gitRef.kind]} ${gitRef.name}`}
          aria-haspopup="menu"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            onMenu({ x: r.left, y: r.bottom + 2 }, e.currentTarget);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            onMenu({ x: e.clientX, y: e.clientY }, e.currentTarget);
          }}
        >
          {content}
        </button>
      ) : (
        content
      )}
      {onRemove && (
        <button
          type="button"
          className="ref-badge-remove"
          aria-label={`Delete remote branch ${gitRef.name}`}
          title={`Delete remote branch ${gitRef.name}`}
          onClick={onRemove}
        >
          <span className="codicon codicon-close" aria-hidden="true" />
        </button>
      )}
    </span>
  );
}
