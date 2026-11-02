import type { Containing } from '../../src/shared/types';

/** `a, b, c, and 4 more`, or `none`. */
function names(list: string[], count: number, max: number): string {
  if (count === 0) return 'none';
  const shown = list.slice(0, max);
  const rest = count - shown.length;
  return rest > 0 ? `${shown.join(', ')}, and ${rest} more` : shown.join(', ');
}

/** "Branches: …" and (when there are any) "Tags: …" lines for a commit. */
export function ContainingLines({ containing, max }: { containing: Containing; max: number }) {
  return (
    <>
      <div className="details-line containing-line">
        <span className="details-label">Branches</span>
        <span className="containing-names">{names(containing.branches, containing.branchCount, max)}</span>
      </div>
      {containing.tagCount > 0 && (
        <div className="details-line containing-line">
          <span className="details-label">Tags</span>
          <span className="containing-names">{names(containing.tags, containing.tagCount, max)}</span>
        </div>
      )}
    </>
  );
}

export interface HoverCardProps {
  /** Undefined while loading, null when it failed. */
  containing: Containing | null | undefined;
  /** Viewport point under the pointer's row. */
  at: { x: number; y: number };
}

const CARD_WIDTH = 320;
const CARD_ROOM = 90;

/** A pointer-only card under a hovered row: which branches and tags include that commit. */
export function HoverCard({ containing, at }: HoverCardProps) {
  const left = Math.max(4, Math.min(at.x, window.innerWidth - CARD_WIDTH - 4));
  const below = at.y + CARD_ROOM < window.innerHeight;
  const style = below ? { left, top: at.y + 4 } : { left, bottom: window.innerHeight - at.y + 28 };
  return (
    <div className="hover-card" role="tooltip" style={style}>
      {containing ? (
        <ContainingLines containing={containing} max={8} />
      ) : (
        <div className="details-line">
          {containing === null ? 'Could not list the branches' : 'Finding branches…'}
        </div>
      )}
    </div>
  );
}
