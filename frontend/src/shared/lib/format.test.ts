import { describe, expect, it } from 'vitest';
import { fmtDate, fmtDateTime, rs, ymdToDmy, fmtNumber } from './format';

describe('format', () => {
  it('formats dates as dd-mm-yyyy', () => {
    expect(fmtDate(new Date(2026, 9, 3))).toBe('03-10-2026');
    expect(fmtDate(null)).toBe('—');
    expect(fmtDate('not a date', '')).toBe('');
  });
  it('formats date-times', () => {
    expect(fmtDateTime(new Date(2026, 0, 5, 7, 9))).toBe('05-01-2026 07:09');
  });
  it('converts ymd without timezone shift', () => {
    expect(ymdToDmy('2026-12-31')).toBe('31-12-2026');
    expect(ymdToDmy('Permanent')).toBe('Permanent');
  });
  it('formats money', () => {
    expect(rs(1000)).toBe('Rs 1,000');
    expect(rs('abc')).toBe('Rs 0');
    expect(fmtNumber(1234567)).toBe('1,234,567');
  });
});
