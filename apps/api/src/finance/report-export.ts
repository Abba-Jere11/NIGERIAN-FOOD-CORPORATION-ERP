import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { canonicalize, formatKobo, type ReportView } from '@nfc/shared';

export function resultHash(view: Pick<ReportView, 'kind' | 'rows'>): string {
  const grid = view.rows.map((row) => ({
    key: row.key,
    current: row.cells.currentKobo,
    compare: row.cells.compareKobo ?? null,
  }));
  return createHash('sha256').update(canonicalize({ kind: view.kind, grid })).digest('hex');
}

export function reportToCsv(view: ReportView): string {
  const header = ['Line', ...view.columns];
  const lines = [header.map(csvCell).join(',')];
  for (const row of view.rows) {
    const values = [row.label, formatKobo(BigInt(row.cells.currentKobo))];
    if (view.columns.includes('Comparison')) values.push(formatKobo(BigInt(row.cells.compareKobo ?? 0)));
    if (view.columns.includes('Variance')) values.push(formatKobo(BigInt(row.cells.varianceKobo ?? 0)));
    lines.push(values.map(csvCell).join(','));
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

function csvCell(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  if (/[",\r\n]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}

export async function reportToXlsx(view: ReportView): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'NFC Mini ERP';
  const sheet = workbook.addWorksheet(view.title.slice(0, 31));
  sheet.addRow(['Nigeria Food Corporation']);
  sheet.addRow([view.title]);
  sheet.addRow([view.entityLabel, view.periodLabel, view.runReference]);
  sheet.addRow([]);
  sheet.addRow(['Line', ...view.columns]);
  for (const row of view.rows) {
    const values: Array<string | number> = [row.label, row.cells.currentKobo / 100];
    if (view.columns.includes('Comparison')) values.push((row.cells.compareKobo ?? 0) / 100);
    if (view.columns.includes('Variance')) values.push((row.cells.varianceKobo ?? 0) / 100);
    sheet.addRow(values);
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export function reportToPdf(view: ReportView): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.fontSize(11).font('Times-Bold').text('NIGERIA FOOD CORPORATION');
    doc.fontSize(14).text(view.title);
    doc.fontSize(9).font('Times-Roman').text(`${view.entityLabel} · ${view.periodLabel} · ${view.runReference}`);
    doc.moveDown();
    const col = view.columns;
    doc.font('Times-Bold').text(['Line', ...col].join('    '));
    doc.font('Times-Roman');
    for (const row of view.rows) {
      const parts = [row.label, formatKobo(BigInt(row.cells.currentKobo))];
      if (col.includes('Comparison')) parts.push(formatKobo(BigInt(row.cells.compareKobo ?? 0)));
      if (col.includes('Variance')) parts.push(formatKobo(BigInt(row.cells.varianceKobo ?? 0)));
      doc.font(row.bold ? 'Times-Bold' : 'Times-Roman').text(parts.join('    '));
    }
    doc.end();
  });
}
