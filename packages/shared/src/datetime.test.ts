import { describe, expect, it } from 'vitest';
import {
  daysBetween,
  formatLagosDate,
  formatLagosDateTime,
  formatLagosDateTimeWithSeconds,
  formatLagosLongDate,
  formatLagosTime,
  toUtcIso,
} from './datetime';

// Africa/Lagos is UTC+1 all year round, with no daylight saving.
describe('Lagos display formatting', () => {
  it('formats a UTC instant as DD/MM/YYYY HH:mm', () => {
    const instant = '2026-09-29T13:05:00.000Z';
    expect(formatLagosDate(instant)).toBe('29/09/2026');
    expect(formatLagosTime(instant)).toBe('14:05');
    expect(formatLagosDateTime(instant)).toBe('29/09/2026 14:05');
  });

  it('rolls the date forward for late-evening UTC times', () => {
    expect(formatLagosDateTime('2026-09-28T23:30:00.000Z')).toBe('29/09/2026 00:30');
  });

  it('uses a 24-hour clock and shows midnight as 00', () => {
    expect(formatLagosTime('2026-01-14T23:00:00.000Z')).toBe('00:00');
    expect(formatLagosTime('2026-01-15T12:00:00.000Z')).toBe('13:00');
    expect(formatLagosTime('2026-01-15T22:45:00.000Z')).toBe('23:45');
  });

  it('adds seconds where an audit trail needs them', () => {
    expect(formatLagosDateTimeWithSeconds('2026-09-29T13:05:32.000Z')).toBe('29/09/2026 14:05:32');
  });

  it('formats long dates for memo headers', () => {
    expect(formatLagosLongDate('2026-09-29T13:05:00.000Z')).toBe('29 September 2026');
  });

  it('stores UTC unchanged', () => {
    expect(toUtcIso(new Date('2026-09-29T13:05:00.000Z'))).toBe('2026-09-29T13:05:00.000Z');
  });

  it('rejects invalid input rather than rendering "Invalid Date"', () => {
    expect(() => formatLagosDate('not a date')).toThrow(RangeError);
  });
});

describe('daysBetween', () => {
  it('counts whole elapsed days for SLA thresholds', () => {
    const arrived = '2026-09-20T09:00:00.000Z';
    expect(daysBetween(arrived, '2026-09-22T08:59:00.000Z')).toBe(1);
    expect(daysBetween(arrived, '2026-09-22T09:00:00.000Z')).toBe(2);
    expect(daysBetween(arrived, '2026-09-25T09:00:00.000Z')).toBe(5);
    expect(daysBetween(arrived, '2026-09-27T09:00:00.000Z')).toBe(7);
  });
});
