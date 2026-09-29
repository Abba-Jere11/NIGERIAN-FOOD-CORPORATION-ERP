import { describe, expect, it } from 'vitest';
import { computeDiff, valuesEqual } from './diff';

describe('computeDiff', () => {
  it('records a creation as new values only', () => {
    const diff = computeDiff(null, { name: 'Operations', status: 'ACTIVE' });
    expect(diff.oldValue).toBeNull();
    expect(diff.newValue).toEqual({ name: 'Operations', status: 'ACTIVE' });
    expect(diff.changedFields).toEqual(['name', 'status']);
  });

  it('records only the fields that actually changed', () => {
    const diff = computeDiff(
      { name: 'Operations', status: 'ACTIVE', code: 'OPS' },
      { name: 'Operations', status: 'INACTIVE' },
    );
    expect(diff.changedFields).toEqual(['status']);
    expect(diff.oldValue).toEqual({ status: 'ACTIVE' });
    expect(diff.newValue).toEqual({ status: 'INACTIVE' });
  });

  it('returns an empty diff when nothing moved', () => {
    const diff = computeDiff({ name: 'Finance' }, { name: 'Finance' });
    expect(diff.changedFields).toEqual([]);
    expect(diff.oldValue).toBeNull();
    expect(diff.newValue).toBeNull();
  });

  it('normalises dates and bigints so audit JSON is stable', () => {
    const diff = computeDiff(
      { amount: 100n, at: new Date('2026-01-01T00:00:00.000Z') },
      { amount: 250n, at: new Date('2026-01-01T00:00:00.000Z') },
    );
    expect(diff.changedFields).toEqual(['amount']);
    expect(diff.oldValue).toEqual({ amount: '100' });
    expect(diff.newValue).toEqual({ amount: '250' });
  });

  it('treats a previously absent field as null rather than undefined', () => {
    const diff = computeDiff({}, { reason: 'Restructure' });
    expect(diff.oldValue).toEqual({ reason: null });
    expect(diff.newValue).toEqual({ reason: 'Restructure' });
  });
});

describe('valuesEqual', () => {
  it('compares nested objects irrespective of key order', () => {
    expect(valuesEqual({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 })).toBe(true);
    expect(valuesEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(valuesEqual([1, 2], [1, 2])).toBe(true);
    expect(valuesEqual([1, 2], [2, 1])).toBe(false);
  });
});
