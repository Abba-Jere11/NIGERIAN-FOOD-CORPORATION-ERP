import PDFDocument from 'pdfkit';
import { ORGANIZATION_NAME, formatKobo, formatLagosDate } from '@nfc/shared';
import { nfcLogoPath } from '../procurement/letterhead-logo';

function letterhead(doc: PDFKit.PDFDocument): void {
  const logo = nfcLogoPath();
  if (logo) {
    try {
      doc.image(logo, 48, 36, { width: 48 });
    } catch {
      /* letterhead still prints without the seal */
    }
  }
  doc.fontSize(14).text(ORGANIZATION_NAME, 48, 48, { align: 'center' });
  doc.moveDown(1.5);
}

export function renderOfferPdf(input: {
  reference: string;
  candidateName: string;
  title: string;
  entityName: string;
  entityCode: string;
  startsOn: string | null;
  salaryKobo: number | null;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    letterhead(doc);
    doc.fontSize(12).text('OFFER OF APPOINTMENT', { align: 'center' });
    doc.moveDown();
    doc.fontSize(10);
    doc.text(`Reference: ${input.reference}`);
    doc.text(`Date: ${formatLagosDate(new Date().toISOString())}`);
    doc.moveDown();
    doc.text(`Dear ${input.candidateName},`);
    doc.moveDown(0.5);
    doc.text(
      `We are pleased to offer you the position of ${input.title} at ${input.entityName} (${input.entityCode}).`,
    );
    if (input.startsOn) doc.text(`Proposed start date: ${input.startsOn}.`);
    if (input.salaryKobo != null) doc.text(`Offered monthly pay: ${formatKobo(BigInt(input.salaryKobo))}.`);
    doc.moveDown();
    doc.text('This offer is subject to HR confirmation and completion of onboarding.');
    doc.end();
  });
}

export function renderAppointmentPdf(input: {
  reference: string;
  employeeName: string;
  title: string;
  entityName: string;
  entityCode: string;
  dateEmployed: string | null;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    letterhead(doc);
    doc.fontSize(12).text('LETTER OF APPOINTMENT', { align: 'center' });
    doc.moveDown();
    doc.fontSize(10);
    doc.text(`Employee number: ${input.reference}`);
    doc.text(`Name: ${input.employeeName}`);
    doc.text(`Position: ${input.title}`);
    doc.text(`Subsidiary: ${input.entityName} (${input.entityCode})`);
    if (input.dateEmployed) doc.text(`Date employed: ${input.dateEmployed}.`);
    doc.moveDown();
    doc.text('This appointment is recorded in the people system. Payroll processing is a later milestone.');
    doc.end();
  });
}
