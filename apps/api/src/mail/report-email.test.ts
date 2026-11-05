import { describe, expect, it } from 'vitest';
import { reportEmailHtml, reportEmailSubject, reportEmailText } from './report-email';

const copy = {
  senderName: 'Dr. Babagana Adam',
  fromAddress: 'md@nfc.com',
  recipient: 'board@example.com',
  title: 'Income statement',
  runReference: 'RPT-2026-000012',
  entityLabel: 'YFZ',
  periodLabel: 'January 2026',
  sentAt: new Date('2026-10-14T12:00:00Z'),
  message: 'For the board pack.',
  filename: 'RPT-2026-000012.pdf',
};

describe('executive report email copy', () => {
  it('names the report in the subject and never includes a link', () => {
    const subject = reportEmailSubject(copy);
    const text = reportEmailText(copy);
    const html = reportEmailHtml(copy);
    expect(subject).toContain('RPT-2026-000012');
    expect(text).toMatch(/Managing Director/);
    expect(text).toContain('For the board pack.');
    expect(html).toContain('Nigeria Food Corporation');
    expect(html).toContain(copy.filename);
    for (const part of [subject, text, html]) {
      expect(part).not.toMatch(/https?:\/\//i);
      expect(part).not.toMatch(/\bhref=/i);
    }
  });
});
