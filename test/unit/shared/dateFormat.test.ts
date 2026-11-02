import { describe, expect, it } from 'vitest';
import { formatDate } from '../../../src/shared/dateFormat';

const now = Date.UTC(2026, 10, 1, 12);
const DAY = 86_400_000;

describe('formatDate', () => {
  it('relative: under a minute is now', () => {
    expect(formatDate(now - 30_000, 'relative', 'en', now)).toBe('now');
  });
  it('relative: minutes, hours, days', () => {
    expect(formatDate(now - 5 * 60_000, 'relative', 'en', now)).toBe('5 minutes ago');
    expect(formatDate(now - 2 * 3_600_000, 'relative', 'en', now)).toBe('2 hours ago');
    expect(formatDate(now - DAY, 'relative', 'en', now)).toBe('yesterday');
    expect(formatDate(now - 3 * DAY, 'relative', 'en', now)).toBe('3 days ago');
  });
  it('relative: a week or more falls back to locale', () => {
    const t = now - 10 * DAY;
    expect(formatDate(t, 'relative', 'en', now)).toBe(formatDate(t, 'locale', 'en', now));
  });
  it('locale uses medium date and short time', () => {
    expect(formatDate(now, 'locale', 'en', now)).toBe(
      new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(now),
    );
  });
  it('iso', () => {
    expect(formatDate(now, 'iso', 'en', now)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(formatDate(now, 'iso', 'en', now)).toBe('2026-11-01 12:00');
  });
  it('pattern tokens', () => {
    expect(formatDate(now - 10 * DAY, 'DD/MM/YYYY', 'en', now)).toBe('22/10/2026');
    expect(formatDate(Date.UTC(2026, 0, 2, 3, 4, 5), 'YYYY-MM-DD HH:mm:ss', 'en', now)).toBe(
      '2026-01-02 03:04:05',
    );
  });
});
