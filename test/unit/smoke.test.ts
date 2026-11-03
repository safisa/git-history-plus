import { describe, expect, it } from 'vitest';
import { EXT_ID, NS, SCHEME } from '../../src/constants';

describe('constants', () => {
  it('identifies the extension', () => {
    expect(EXT_ID).toBe('safisa.githistory-plus');
    expect(NS).toBe('gitHistoryPlus');
    expect(SCHEME).toBe('git-history-plus');
  });
});
