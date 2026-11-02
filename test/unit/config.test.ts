import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { configValues } from '../mocks/vscode';
import { getConfig } from '../../src/config';

interface Prop {
  type: string;
  minimum?: number;
  maximum?: number;
  default: unknown;
}
const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  contributes: { configuration: { properties: Record<string, Prop> } };
};
const prop = (k: string) => manifest.contributes.configuration.properties[`gitHistoryPlus.${k}`]!;

afterEach(() => {
  for (const k of Object.keys(configValues)) delete configValues[k];
});

describe('settings bounds', () => {
  it('declares pageSize as an integer in 1..1000 and defaultMaxCount as an integer >= 0', () => {
    expect(prop('pageSize')).toMatchObject({ type: 'integer', minimum: 1, maximum: 1000, default: 100 });
    expect(prop('defaultMaxCount')).toMatchObject({ type: 'integer', minimum: 0, default: 0 });
  });

  it.each([
    [5000, 1000],
    [1000, 1000],
    [250.9, 250],
    [0, 1],
    [-3, 1],
    ['x', 100],
    [Number.NaN, 100],
  ])('clamps pageSize %j to %j', (value, expected) => {
    configValues.pageSize = value;
    expect(getConfig().pageSize).toBe(expected);
  });

  it.each([
    [-1, 0],
    [0, 0],
    [12.5, 12],
    ['many', 0],
  ])('clamps defaultMaxCount %j to %j', (value, expected) => {
    configValues.defaultMaxCount = value;
    expect(getConfig().defaultMaxCount).toBe(expected);
  });
});

describe('dimMergeCommits and showStatusBarItem', () => {
  it('default to on, and follow the setting', () => {
    expect(prop('dimMergeCommits')).toMatchObject({ type: 'boolean', default: true });
    expect(prop('showStatusBarItem')).toMatchObject({ type: 'boolean', default: true });
    expect(getConfig()).toMatchObject({ dimMergeCommits: true, showStatusBarItem: true });
    configValues.dimMergeCommits = false;
    configValues.showStatusBarItem = false;
    expect(getConfig()).toMatchObject({ dimMergeCommits: false, showStatusBarItem: false });
  });
});

describe('issueLinks', () => {
  it('keeps well-formed entries only, at most 20', () => {
    configValues.issueLinks = [
      { pattern: 'A-\\d+', url: 'https://x/$0', extra: 1 },
      { pattern: '', url: 'https://x' },
      { pattern: 'B', url: 7 },
      'nope',
      null,
      ...Array.from({ length: 30 }, (_, i) => ({ pattern: `P${i}`, url: 'https://x' })),
    ];
    const links = getConfig().issueLinks;
    expect(links[0]).toEqual({ pattern: 'A-\\d+', url: 'https://x/$0' });
    expect(links).toHaveLength(20);
  });

  it('is empty when unset or not an array', () => {
    expect(getConfig().issueLinks).toEqual([]);
    configValues.issueLinks = 'x';
    expect(getConfig().issueLinks).toEqual([]);
  });
});
