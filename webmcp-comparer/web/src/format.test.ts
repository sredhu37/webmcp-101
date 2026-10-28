import { describe, expect, it } from 'vitest';
import { formatRunDate, siteLabel } from './format.ts';

describe('formatRunDate', () => {
  const now = new Date(2026, 9, 16, 10, 0);

  it('says Today and Yesterday for recent Runs', () => {
    expect(formatRunDate(new Date(2026, 9, 16, 9, 5).toISOString(), now)).toBe('Today 09:05');
    expect(formatRunDate(new Date(2026, 9, 15, 17, 45).toISOString(), now)).toBe('Yesterday 17:45');
  });

  it('gives the date for older Runs, with the year only when it differs', () => {
    expect(formatRunDate(new Date(2026, 9, 2, 8, 0).toISOString(), now)).toBe('2 Oct 08:00');
    expect(formatRunDate(new Date(2025, 11, 31, 23, 59).toISOString(), now)).toBe(
      '31 Dec 2025 23:59',
    );
  });
});

describe('siteLabel', () => {
  it('drops the scheme and a trailing slash', () => {
    expect(siteLabel('http://localhost:4000')).toBe('localhost:4000');
    expect(siteLabel('https://shop.example.com/de/')).toBe('shop.example.com/de');
    expect(siteLabel('not a url')).toBe('not a url');
  });
});
