import { describe, expect, it } from 'vitest';
import { computeGraph, computeTimeline } from '../../../src/git/graph';

const c = (hash: string, ...parents: string[]) => ({ hash, parents });
const seg = (r: { segments: { from: number; to: number; half: string }[] }, half: string) =>
  r.segments
    .filter((s) => s.half === half)
    .map((s) => `${s.from}>${s.to}`)
    .sort();
const MERGE = [c('M', 'A', 'B'), c('A', 'C'), c('B', 'C'), c('C')];

describe('computeGraph', () => {
  it('keeps linear history on lane 0', () => {
    const { rows } = computeGraph([c('a', 'b'), c('b', 'c'), c('c')]);
    expect(rows.map((r) => r.lane)).toEqual([0, 0, 0]);
    expect(seg(rows[0]!, 'top')).toEqual([]);
    expect(seg(rows[1]!, 'top')).toEqual(['0>0']);
  });

  it('draws branch and merge', () => {
    const { rows } = computeGraph(MERGE);
    expect(rows[0]!.lane).toBe(0);
    expect(seg(rows[0]!, 'bottom')).toEqual(['0>0', '0>1']);
    expect(rows[2]!.lane).toBe(1);
    expect(seg(rows[2]!, 'top')).toContain('1>1');
    expect(seg(rows[3]!, 'top')).toEqual(['0>0', '1>0']);
  });

  it('opens three lanes for an octopus merge', () => {
    const { rows, carry } = computeGraph([c('O', 'a', 'b', 'c')]);
    expect(seg(rows[0]!, 'bottom')).toEqual(['0>0', '0>1', '0>2']);
    expect(carry.lanes).toEqual(['a', 'b', 'c']);
  });

  it('pages seamlessly through carry', () => {
    const whole = computeGraph(MERGE);
    const p1 = computeGraph(MERGE.slice(0, 2));
    const p2 = computeGraph(MERGE.slice(2), p1.carry);
    expect([...p1.rows, ...p2.rows]).toEqual(whole.rows);
    expect(p2.carry).toEqual(whole.carry);
  });

  it('keeps colour stable down a line and new colour for new lanes', () => {
    const { rows } = computeGraph([c('a', 'b'), c('b', 'c'), c('c')]);
    expect(new Set(rows.map((r) => r.color)).size).toBe(1);
    const m = computeGraph(MERGE).rows;
    expect(m[0]!.color).not.toBe(m[2]!.color);
  });
});

describe('computeTimeline (filtered lists: file, line, search, author)', () => {
  // Filtered lists report real parents that are mostly not in the list; a lane graph would open a
  // new lane per row that never closes. A timeline is one lane with a dot per row.
  const ROWS = [c('C', 'x'), c('B', 'y'), c('A', 'z')];

  it('puts every commit on lane 0 joined by one line, with open ends only where the list goes on', () => {
    const { rows } = computeTimeline(ROWS, undefined, false);
    expect(rows.map((r) => r.lane)).toEqual([0, 0, 0]);
    expect(rows.map((r) => [seg(r, 'top'), seg(r, 'bottom')])).toEqual([
      [[], ['0>0']],
      [['0>0'], ['0>0']],
      [['0>0'], []],
    ]);
  });

  it('continues seamlessly across pages', () => {
    const p1 = computeTimeline(ROWS.slice(0, 2), undefined, true);
    expect(seg(p1.rows[1]!, 'bottom')).toEqual(['0>0']);
    const p2 = computeTimeline(ROWS.slice(2), p1.carry, false);
    expect(seg(p2.rows[0]!, 'top')).toEqual(['0>0']);
    expect(seg(p2.rows[0]!, 'bottom')).toEqual([]);
  });

  it('draws a lone dot for a single commit', () => {
    expect(computeTimeline([c('A', 'z')], undefined, false).rows[0]!.segments).toEqual([]);
  });
});
