import type { GraphRow, GraphSegment } from '../../src/shared/types';

export const LANE_WIDTH = 12;
export const ROW_HEIGHT = 24;
/**
 * Number of lane colours. styles.css defines `.lane-color-0` … `.lane-color-5` as the theme's
 * `charts.blue|green|yellow|orange|purple|red`, each falling back to a `gitDecoration.*` colour.
 */
export const LANE_COLORS = 6;

const MID = ROW_HEIGHT / 2;
const x = (lane: number) => lane * LANE_WIDTH + LANE_WIDTH / 2;
export const laneColorClass = (color: number) =>
  `lane-color-${((color % LANE_COLORS) + LANE_COLORS) % LANE_COLORS}`;

/** A `top` segment runs (from, 0) → (to, 12); a `bottom` one (from, 12) → (to, 24). */
function edgePath(s: GraphSegment): string {
  const y0 = s.half === 'top' ? 0 : MID;
  const y1 = y0 + MID;
  const x0 = x(s.from);
  const x1 = x(s.to);
  if (x0 === x1) return `M${x0} ${y0} L${x1} ${y1}`;
  const ym = y0 + MID / 2;
  return `M${x0} ${y0} C${x0} ${ym} ${x1} ${ym} ${x1} ${y1}`;
}

export interface GraphCellProps {
  row: GraphRow;
  /** The column width in lanes, shared by every row. */
  lanes: number;
  /** The uncommitted changes row: a hollow dashed node and a dashed line down. */
  worktree?: boolean;
  /** The row under it: the line coming down this lane from the uncommitted row is dashed. */
  dashedFrom?: number;
}

const isDashed = (p: GraphCellProps, s: GraphSegment) =>
  p.worktree ? s.half === 'bottom' && s.from === p.row.lane : s.half === 'top' && s.from === p.dashedFrom;

/** One row of the commit graph. */
export function GraphCell(p: GraphCellProps) {
  const { row, lanes } = p;
  return (
    <svg
      className="graph"
      width={Math.max(lanes, 1) * LANE_WIDTH}
      height={ROW_HEIGHT}
      aria-hidden="true"
      focusable="false"
    >
      {row.segments.map((s, i) => (
        <path
          key={i}
          data-half={s.half}
          className={`graph-edge ${laneColorClass(s.color)}${isDashed(p, s) ? ' is-dashed' : ''}`}
          d={
            // The line leaves the hollow uncommitted node from its rim, not its centre.
            p.worktree && s.half === 'bottom' && s.from === row.lane && s.to === row.lane
              ? `M${x(row.lane)} ${MID + 4} L${x(row.lane)} ${ROW_HEIGHT}`
              : edgePath(s)
          }
        />
      ))}
      <circle
        className={`graph-node ${laneColorClass(row.color)}${p.worktree ? ' is-worktree' : ''}`}
        cx={x(row.lane)}
        cy={MID}
        r={4}
      />
    </svg>
  );
}

/** Lanes needed to draw every row: the widest lane or segment end, plus one. */
export function laneCount(rows: GraphRow[]): number {
  let max = 0;
  for (const r of rows) {
    max = Math.max(max, r.lane);
    for (const s of r.segments) max = Math.max(max, s.from, s.to);
  }
  return max + 1;
}
