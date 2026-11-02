import { afterEach, describe, expect, it } from 'vitest';
import { computeGraph } from '../../../src/git/graph';
import type { GraphRow } from '../../../src/shared/types';
import { GraphCell, LANE_COLORS, LANE_WIDTH } from '../../../webview/components/GraphCell';
import { render } from './helpers';

const c = (hash: string, ...parents: string[]) => ({ hash, parents });
// Same fixture as test/unit/git/graph.test.ts: M merges A and B, both from C.
const MERGE = [c('M', 'A', 'B'), c('A', 'C'), c('B', 'C'), c('C')];

let cleanup: (() => void) | undefined;
afterEach(() => cleanup?.());

function draw(row: GraphRow, lanes = 3) {
  const r = render(<GraphCell row={row} lanes={lanes} />);
  cleanup = r.unmount;
  return r.container.querySelector('svg')!;
}

describe('GraphCell', () => {
  it('draws the merge row with two bottom paths and no top paths', () => {
    const svg = draw(computeGraph(MERGE).rows[0]!);
    expect(svg.querySelectorAll('path[data-half="bottom"]')).toHaveLength(2);
    expect(svg.querySelectorAll('path[data-half="top"]')).toHaveLength(0);
  });

  it('is 24 px high, 12 px per lane, with the node at lane*12+6, 12', () => {
    const svg = draw({ lane: 1, color: 0, segments: [] }, 3);
    expect(LANE_WIDTH).toBe(12);
    expect(svg.getAttribute('height')).toBe('24');
    expect(svg.getAttribute('width')).toBe('36');
    const node = svg.querySelector('circle')!;
    expect([node.getAttribute('cx'), node.getAttribute('cy')]).toEqual(['18', '12']);
  });

  it('runs top segments from y=0 to y=12 and bottom segments from y=12 to y=24', () => {
    const svg = draw({
      lane: 0,
      color: 0,
      segments: [
        { from: 1, to: 0, half: 'top', color: 1 },
        { from: 0, to: 1, half: 'bottom', color: 2 },
      ],
    });
    const top = svg.querySelector('path[data-half="top"]')!.getAttribute('d')!;
    const bottom = svg.querySelector('path[data-half="bottom"]')!.getAttribute('d')!;
    expect(top.startsWith('M18 0')).toBe(true);
    expect(top.endsWith('6 12')).toBe(true);
    expect(bottom.startsWith('M6 12')).toBe(true);
    expect(bottom.endsWith('18 24')).toBe(true);
  });

  it('picks colours by color % palette length, using classes rather than inline colours', () => {
    const svg = draw({
      lane: 0,
      color: LANE_COLORS + 2,
      segments: [{ from: 0, to: 0, half: 'bottom', color: 1 }],
    });
    expect(svg.querySelector('circle')!.getAttribute('class')).toContain('lane-color-2');
    expect(svg.querySelector('path')!.getAttribute('class')).toContain('lane-color-1');
    expect(svg.outerHTML).not.toMatch(/style=|fill="#|stroke="#/);
  });
});
