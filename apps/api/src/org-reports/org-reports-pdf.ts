import PDFDocument from 'pdfkit';
import { ORGANIZATION_NAME, formatLagosDate, formatLagosDateTime } from '@nfc/shared';
import { nfcLogoPath } from '../procurement/letterhead-logo';

function drawLetterhead(doc: PDFKit.PDFDocument, heading: string, reference: string, date: string): void {
  const logo = nfcLogoPath();
  if (logo) {
    const size = 48;
    const x =
      doc.page.margins.left +
      (doc.page.width - doc.page.margins.left - doc.page.margins.right - size) / 2;
    doc.image(logo, x, doc.y, { width: size, height: size });
    doc.y += size + 8;
  }
  doc.font('Helvetica-Bold').fontSize(14).text(ORGANIZATION_NAME, { align: 'center' });
  doc.moveDown(0.2);
  doc.fontSize(12).text(heading, { align: 'center' });
  doc.font('Helvetica').fontSize(10).text(`${reference}  ·  ${date}`, { align: 'center' });
  doc.moveDown();
}

function line(doc: PDFKit.PDFDocument, label: string, value: string): void {
  doc.font('Helvetica-Bold').fontSize(10).text(`${label}: `, { continued: true });
  doc.font('Helvetica').text(value || '—');
}

export function renderOrgReportPdf(input: {
  referenceNumber: string;
  title: string;
  templateTitle: string;
  reportDate: string;
  entityName: string;
  entityCode: string;
  senderName: string;
  toName: string;
  ccNames: string[];
  body: string;
  observations: string | null;
  reportingPeriod: string | null;
  forwards: Array<{ by: string; at: string; recipients: string; note: string | null }>;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    drawLetterhead(doc, 'OFFICIAL REPORT', input.referenceNumber, formatLagosDate(input.reportDate));
    line(doc, 'Document type', input.templateTitle);
    line(doc, 'Subject', input.title);
    line(doc, 'Originating unit', `${input.entityName} (${input.entityCode})`);
    if (input.reportingPeriod) line(doc, 'Reporting period', input.reportingPeriod);
    doc.moveDown(0.4);
    doc.font('Helvetica-Bold').text('Original correspondence');
    doc.font('Helvetica');
    line(doc, 'From', input.senderName);
    line(doc, 'To', input.toName);
    line(doc, 'CC', input.ccNames.length > 0 ? input.ccNames.join(', ') : 'None');
    doc.moveDown(0.4);
    doc.font('Helvetica-Bold').text('Report');
    doc.font('Helvetica').text(input.body);
    if (input.observations) {
      doc.moveDown(0.4);
      doc.font('Helvetica-Bold').text('Observations / recommendations');
      doc.font('Helvetica').text(input.observations);
    }
    if (input.forwards.length > 0) {
      doc.moveDown(0.6);
      doc.font('Helvetica-Bold').text('Subsequent forwarding (not part of the original correspondence)');
      doc.font('Helvetica');
      for (const forward of input.forwards) {
        line(doc, 'Forwarded by', forward.by);
        line(doc, 'Date', formatLagosDateTime(forward.at));
        line(doc, 'Additional recipients', forward.recipients);
        if (forward.note) line(doc, 'Note', forward.note);
        doc.moveDown(0.3);
      }
    }
    doc.end();
  });
}

export function renderOrgMinutePdf(input: {
  referenceNumber: string;
  subject: string;
  issuedAt: string;
  issuerName: string;
  toName: string;
  ccNames: string[];
  relatedReport: string;
  instruction: string;
  expectedOutcome: string | null;
  dueAt: string | null;
  responseRequired: boolean;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    drawLetterhead(doc, 'OFFICIAL MINUTE', input.referenceNumber, formatLagosDate(input.issuedAt));
    line(doc, 'From', input.issuerName);
    line(doc, 'To', input.toName);
    line(doc, 'CC', input.ccNames.length > 0 ? input.ccNames.join(', ') : 'None');
    line(doc, 'Subject', input.subject);
    line(doc, 'Related report', input.relatedReport);
    if (input.dueAt) line(doc, 'Deadline', formatLagosDateTime(input.dueAt));
    line(doc, 'Response required', input.responseRequired ? 'Yes' : 'No');
    doc.moveDown(0.5);
    doc.font('Helvetica-Bold').text('Instruction');
    doc.font('Helvetica').text(input.instruction);
    if (input.expectedOutcome) {
      doc.moveDown(0.4);
      doc.font('Helvetica-Bold').text('Expected outcome');
      doc.font('Helvetica').text(input.expectedOutcome);
    }
    doc.moveDown(0.8);
    doc.font('Helvetica').fontSize(9).text(`Authorised issuer: ${input.issuerName}, ${ORGANIZATION_NAME}`);
    doc.end();
  });
}

export function renderOrgResponsePdf(input: {
  referenceNumber: string;
  minuteReference: string;
  subject: string;
  officerName: string;
  submittedAt: string;
  body: string;
  outcome: string | null;
  status: string;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    drawLetterhead(doc, 'OFFICIAL RESPONSE', input.referenceNumber, formatLagosDate(input.submittedAt));
    line(doc, 'Linked minute', input.minuteReference);
    line(doc, 'Responding officer', input.officerName);
    line(doc, 'Subject', input.subject);
    line(doc, 'Status', input.status.replaceAll('_', ' '));
    doc.moveDown(0.4);
    doc.font('Helvetica-Bold').text('Response');
    doc.font('Helvetica').text(input.body);
    if (input.outcome) {
      doc.moveDown(0.4);
      doc.font('Helvetica-Bold').text('Outcome / findings');
      doc.font('Helvetica').text(input.outcome);
    }
    doc.end();
  });
}
