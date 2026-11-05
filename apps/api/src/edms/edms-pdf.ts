import PDFDocument from 'pdfkit';
import { ORGANIZATION_NAME, formatLagosDateTime } from '@nfc/shared';
import { nfcLogoPath } from '../procurement/letterhead-logo';

function letterhead(doc: PDFKit.PDFDocument, heading: string): void {
  const logo = nfcLogoPath();
  if (logo) {
    const size = 40;
    const x = doc.page.margins.left + (doc.page.width - doc.page.margins.left - doc.page.margins.right - size) / 2;
    doc.image(logo, x, doc.y, { width: size, height: size });
    doc.y += size + 8;
  }
  doc.fontSize(12).text(ORGANIZATION_NAME, { align: 'center' });
  doc.moveDown(0.2);
  doc.fontSize(11).text(heading, { align: 'center' });
  doc.moveDown();
  doc.fontSize(9);
}

function renderPdf(draw: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    draw(doc);
    doc.end();
  });
}

export function renderApprovalDocumentsPdf(input: {
  reference: string;
  title: string;
  entityName: string;
  seals: Array<{ action: string; actorName: string; occurredAt: string }>;
  actions: Array<{ stage: string; action: string; actorName: string; occurredAt: string; reason: string | null }>;
}): Promise<Buffer> {
  return renderPdf((doc) => {
    letterhead(doc, `APPROVAL DOCUMENTS  ·  ${input.reference}`);
    doc.fontSize(10).text(`Subject: ${input.title}`);
    doc.text(`Subsidiary: ${input.entityName}`);
    doc.moveDown(0.4);
    doc.fontSize(11).text('Seals');
    doc.fontSize(9);
    if (input.seals.length === 0) {
      doc.text('No seals recorded.');
    }
    for (const seal of input.seals) {
      doc.text(`${seal.action} — ${seal.actorName} — ${formatLagosDateTime(seal.occurredAt)}`);
    }
    doc.moveDown(0.4);
    doc.fontSize(11).text('Workflow actions');
    doc.fontSize(9);
    if (input.actions.length === 0) {
      doc.text('No workflow actions recorded.');
    }
    for (const action of input.actions) {
      doc.text(
        `${action.stage}: ${action.action} — ${action.actorName} — ${formatLagosDateTime(action.occurredAt)}${
          action.reason ? ` — ${action.reason}` : ''
        }`,
      );
    }
  });
}

export function renderCompletionRecordPdf(input: {
  reference: string;
  title: string;
  entityName: string;
  status: string;
  completedAt: string;
}): Promise<Buffer> {
  return renderPdf((doc) => {
    letterhead(doc, `COMPLETION RECORD  ·  ${input.reference}`);
    doc.fontSize(10);
    doc.text(`Subject: ${input.title}`);
    doc.text(`Subsidiary: ${input.entityName}`);
    doc.text(`Status: ${input.status}`);
    doc.text(`Recorded: ${formatLagosDateTime(input.completedAt)}`);
    doc.moveDown(0.5);
    doc.text('This procurement request is complete. Supporting files sit in the numbered EDMS slots.');
  });
}

export function renderAuditRecordPdf(input: {
  reference: string;
  title: string;
  events: Array<{ occurredAt: string; actorName: string; text: string }>;
}): Promise<Buffer> {
  return renderPdf((doc) => {
    letterhead(doc, `AUDIT RECORD  ·  ${input.reference}`);
    doc.fontSize(10).text(`Subject: ${input.title}`);
    doc.moveDown(0.4);
    doc.fontSize(9);
    if (input.events.length === 0) {
      doc.text('No timeline events recorded.');
    }
    for (const event of input.events) {
      doc.text(`${formatLagosDateTime(event.occurredAt)} — ${event.actorName}: ${event.text}`);
    }
  });
}
