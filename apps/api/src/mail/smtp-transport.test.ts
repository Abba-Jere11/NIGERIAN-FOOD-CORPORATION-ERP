import { describe, expect, it } from 'vitest';
import { buildMime } from './smtp-transport';

describe('SMTP MIME', () => {
  it('wraps branded HTML and a PDF with no access links', () => {
    const mime = buildMime({
      fromName: 'Dr. Babagana Adam',
      fromAddress: 'md@nfc.com',
      to: 'board@example.com',
      subject: 'NFC · Income statement · YFZ · January 2026 · RPT-2026-000012',
      text: 'The complete report is attached.',
      html: '<p>Nigeria Food Corporation</p>',
      attachments: [
        {
          filename: 'RPT-2026-000012.pdf',
          contentType: 'application/pdf',
          content: Buffer.from('%PDF-test'),
        },
      ],
    });
    expect(mime).toContain('From: "Dr. Babagana Adam" <md@nfc.com>');
    expect(mime).toContain('To: board@example.com');
    expect(mime).toContain('Content-Type: text/html; charset=UTF-8');
    expect(mime).toContain('Content-Disposition: attachment; filename="RPT-2026-000012.pdf"');
    expect(mime).toContain(Buffer.from('%PDF-test').toString('base64'));
    expect(mime).not.toMatch(/https?:\/\//i);
    expect(mime).not.toMatch(/\bhref=/i);
  });
});
