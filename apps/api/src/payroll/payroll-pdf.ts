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

export function renderPayslipPdf(input: {
  runReference: string;
  periodName: string;
  employeeName: string;
  employeeNumber: string;
  entityName: string;
  basicKobo: number;
  allowancesKobo: number;
  overtimeKobo: number;
  unpaidLeaveKobo: number;
  loanKobo: number;
  payeKobo: number;
  pensionEmployeeKobo: number;
  otherStatutoryKobo: number;
  grossKobo: number;
  netKobo: number;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    letterhead(doc);
    doc.fontSize(12).text('PAYSLIP', { align: 'center' });
    doc.moveDown();
    doc.fontSize(10);
    doc.text(`Payroll: ${input.runReference}`);
    doc.text(`Period: ${input.periodName}`);
    doc.text(`Employee: ${input.employeeName} (${input.employeeNumber})`);
    doc.text(`Subsidiary: ${input.entityName}`);
    doc.text(`Date: ${formatLagosDate(new Date().toISOString())}`);
    doc.moveDown();
    const line = (label: string, kobo: number) =>
      doc.text(`${label}: ${formatKobo(BigInt(kobo))}`);
    line('Basic', input.basicKobo);
    line('Allowances', input.allowancesKobo);
    line('Overtime', input.overtimeKobo);
    line('Unpaid leave', -input.unpaidLeaveKobo);
    line('Gross', input.grossKobo);
    line('PAYE', -input.payeKobo);
    line('Pension (employee)', -input.pensionEmployeeKobo);
    line('Other statutory', -input.otherStatutoryKobo);
    line('Loan / advance', -input.loanKobo);
    doc.moveDown(0.5);
    doc.fontSize(11).text(`Net pay: ${formatKobo(BigInt(input.netKobo))}`);
    doc.end();
  });
}
