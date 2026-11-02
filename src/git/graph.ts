import type { Commit, GraphCarry, GraphRow, GraphSegment, Hash } from '../shared/types';

/**
 * Assigns each commit (newest first) to a lane and emits the line segments
 * needed to draw it. `carry` threads lane state across pages so paging is seamless.
 */
export function computeGraph(
  commits: Pick<Commit, 'hash' | 'parents'>[],
  carry?: GraphCarry,
): { rows: GraphRow[]; carry: GraphCarry } {
  const lanes: (Hash | null)[] = carry ? [...carry.lanes] : [];
  const colors: number[] = carry ? [...carry.colors] : [];
  let nextColor = carry?.nextColor ?? 0;
  const rows: GraphRow[] = [];

  for (const c of commits) {
    const matches: number[] = [];
    lanes.forEach((h, j) => {
      if (h === c.hash) matches.push(j);
    });
    let lane = matches[0] ?? lanes.indexOf(null);
    if (lane === -1) lane = lanes.length;

    const segments: GraphSegment[] = [];
    lanes.forEach((h, j) => {
      if (h !== null) {
        segments.push({
          from: j,
          to: matches.includes(j) ? lane : j,
          half: 'top',
          color: colors[j] as number,
        });
      }
    });

    const isNewLane = matches.length === 0;
    for (const j of matches) lanes[j] = null;
    const first = c.parents[0] ?? null;
    lanes[lane] = first;
    if (isNewLane) colors[lane] = nextColor++;
    const row = { lane, color: colors[lane] as number };

    const opened = new Set<number>();
    for (const p of c.parents.slice(1)) {
      let k = lanes.indexOf(p);
      if (k === -1) {
        k = lanes.findIndex((h, j) => h === null && j !== lane);
        if (k === -1) k = lanes.length;
        lanes[k] = p;
        colors[k] = nextColor++;
        opened.add(k);
      }
      segments.push({ from: lane, to: k, half: 'bottom', color: colors[k] as number });
    }
    if (first !== null)
      segments.push({ from: lane, to: lane, half: 'bottom', color: colors[lane] as number });
    lanes.forEach((h, j) => {
      if (h !== null && j !== lane && !opened.has(j)) {
        segments.push({ from: j, to: j, half: 'bottom', color: colors[j] as number });
      }
    });

    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();
    colors.length = lanes.length;
    rows.push({ ...row, segments });
  }

  return { rows, carry: { lanes, colors, nextColor } };
}

/**
 * A single-lane timeline for filtered lists (file, line, search or author). Their commits report
 * real parents that are mostly not in the list, so computeGraph would open a lane per row that
 * never closes. `hasMore` keeps the line open below the last row while more pages follow.
 */
export function computeTimeline(
  commits: Pick<Commit, 'hash'>[],
  carry: GraphCarry | undefined,
  hasMore: boolean,
): { rows: GraphRow[]; carry: GraphCarry } {
  const continued = (carry?.lanes.length ?? 0) > 0;
  const rows = commits.map((_, i): GraphRow => {
    const segments: GraphSegment[] = [];
    if (i > 0 || continued) segments.push({ from: 0, to: 0, half: 'top', color: 0 });
    if (i < commits.length - 1 || hasMore) segments.push({ from: 0, to: 0, half: 'bottom', color: 0 });
    return { lane: 0, color: 0, segments };
  });
  const last = commits.at(-1);
  return {
    rows,
    carry:
      hasMore && last
        ? { lanes: [last.hash], colors: [0], nextColor: 1 }
        : { lanes: [], colors: [], nextColor: 1 },
  };
}
