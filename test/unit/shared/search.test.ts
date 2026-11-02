import { describe, expect, it } from 'vitest';
import { parseSearch } from '../../../src/shared/search';

describe('parseSearch', () => {
  it('parses prefixes and quotes', () => {
    expect(parseSearch('author:dana "fix compare" path:src/a.ts')).toEqual({
      author: 'dana',
      text: 'fix compare',
      path: 'src/a.ts',
    });
  });
  it('joins free tokens and handles since/until', () => {
    expect(parseSearch('fix  bug since:2020-01-01 until:2021-01-01')).toEqual({
      text: 'fix bug',
      since: '2020-01-01',
      until: '2021-01-01',
    });
  });
  it('supports quoted prefix values', () => {
    expect(parseSearch('author:"Dana Lee"')).toEqual({ author: 'Dana Lee' });
  });
  it('returns empty object for blank input', () => {
    expect(parseSearch('   ')).toEqual({});
  });
  it('tolerates an unterminated quote', () => {
    expect(parseSearch('"fix bug')).toEqual({ text: 'fix bug' });
  });
});
