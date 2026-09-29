import type { AuditEntryView } from '@nfc/shared';
import { describe, expect, it } from 'vitest';
import { ValidationFailedError } from '../common/errors/domain-error';
import { parseAuditBoundary, toCsv } from './audit.service';

function entry(overrides: Partial<AuditEntryView> = {}): AuditEntryView {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    occurredAt: '2026-09-21T09:14:00.000Z',
    actorRef: '00000000-0000-4000-8000-000000000001',
    actorName: 'Adebayo Okonkwo',
    actorRole: 'md',
    actorScopeType: 'CORPORATE',
    action: 'edit',
    subjectType: 'entity',
    subjectId: '11111111-1111-4111-8111-111111111111',
    subjectLabel: 'YFZ - Yobe Fertilizer',
    subjectReferenceNumber: null,
    entityId: '11111111-1111-4111-8111-111111111111',
    entityCode: 'YFZ',
    entityName: 'Yobe Fertilizer',
    oldValue: { name: 'Yobe Fertilizer' },
    newValue: { name: 'Yobe Fertilizer Company' },
    reason: 'Registration updated.',
    ipAddress: '198.51.100.24',
    userAgent: 'Mozilla/5.0',
    sessionId: 'sess-1',
    requestId: 'req-1',
    ...overrides,
  };
}

describe('toCsv()', () => {
  it('writes a header row naming every exported field', () => {
    const [header] = toCsv([]).split('\r\n');
    expect(header).toContain('"Timestamp (UTC)"');
    expect(header).toContain('"Actor"');
    expect(header).toContain('"Role"');
    expect(header).toContain('"Action"');
    expect(header).toContain('"Reason"');
    expect(header).toContain('"IP address"');
    expect(header).toContain('"Request id"');
  });

  it('quotes every cell and doubles embedded quotes', () => {
    const csv = toCsv([entry({ reason: 'He said "no" to the price.' })]);
    expect(csv).toContain('"He said ""no"" to the price."');
  });

  it('keeps a comma inside a cell from splitting the row', () => {
    const csv = toCsv([entry({ subjectLabel: 'YFZ, Zaria plant' })]);
    const rows = csv.split('\r\n');
    expect(rows).toHaveLength(2);
    expect(csv).toContain('"YFZ, Zaria plant"');
  });

  it('neutralises a cell that a spreadsheet would treat as a formula', () => {
    // Without this, opening an export in Excel could execute whatever an
    // attacker typed into a reason field.
    const csv = toCsv([entry({ reason: '=HYPERLINK("http://example.test","click")' })]);
    expect(csv).toContain('"\'=HYPERLINK');
  });

  it.each(['=cmd', '+1', '-1', '@SUM(A1)'])('neutralises a cell starting with %s', (text) => {
    expect(toCsv([entry({ subjectLabel: text })])).toContain(`"'${text}`);
  });

  it('writes an empty cell for a missing value rather than the word null', () => {
    const csv = toCsv([entry({ reason: null, subjectReferenceNumber: null })]);
    expect(csv).not.toContain('null');
  });

  it('serialises the before and after values as JSON', () => {
    const csv = toCsv([entry()]);
    expect(csv).toContain('{""name"":""Yobe Fertilizer""}');
  });
});

describe('parseAuditBoundary()', () => {
  it('reads a bare from date as the start of that day in Lagos', () => {
    expect(parseAuditBoundary('2026-09-21', 'from')).toBe('2026-09-21T00:00:00+01:00');
  });

  it('reads a bare to date as the end of that day in Lagos', () => {
    expect(parseAuditBoundary('2026-09-21', 'to')).toBe('2026-09-21T23:59:59.999+01:00');
  });

  it('covers the whole Lagos day, which in UTC starts the previous evening', () => {
    // 00:00 in Lagos is 23:00 UTC the day before. Treating the filter as UTC
    // would silently drop the first hour of every working day.
    expect(new Date(parseAuditBoundary('2026-09-21', 'from')).toISOString()).toBe(
      '2026-09-20T23:00:00.000Z',
    );
  });

  it('passes a full timestamp through as UTC', () => {
    expect(parseAuditBoundary('2026-09-21T09:14:00Z', 'from')).toBe('2026-09-21T09:14:00.000Z');
  });

  it('refuses something that is not a date', () => {
    expect(() => parseAuditBoundary('last Tuesday', 'from')).toThrow(ValidationFailedError);
    expect(() => parseAuditBoundary('last Tuesday', 'to')).toThrow(/not a valid date/);
  });
});
