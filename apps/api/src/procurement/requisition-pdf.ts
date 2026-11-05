import PDFDocument from 'pdfkit';
import {
  ORGANIZATION_NAME,
  formatLagosDate,
  memoStamps,
  type MemoStamp,
  type RequisitionMemoSnapshot,
} from '@nfc/shared';
import { nfcLogoPath } from './letterhead-logo';

function drawLetterheadLogo(doc: PDFKit.PDFDocument, y: number): void {
  const logo = nfcLogoPath();
  if (logo) {
    try {
      doc.image(logo, 48, y, { width: 36, height: 36 });
    } catch {
      /* logo optional */
    }
  }
}

export function renderRequisitionMemoPdf(
  snapshot: RequisitionMemoSnapshot,
  stamps?: MemoStamp[],
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const startX = 48;
    const pageWidth = 499;
    drawLetterheadLogo(doc, 48);
    doc.fillColor('#06301f').font('Helvetica-Bold').fontSize(14).text(ORGANIZATION_NAME, 92, 52, {
      width: pageWidth - 50,
    });
    doc.fillColor('#5b646e').font('Helvetica').fontSize(9).text('REQUISITION MEMORANDUM', 92, 70);
    doc.moveTo(startX, 96).lineTo(startX + pageWidth, 96).strokeColor('#0b4f3a').lineWidth(2).stroke();

    const ink = '#14181c';
    doc.fillColor(ink).font('Helvetica').fontSize(10);
    doc.text(`To: Managing Director`, startX, 110);
    doc.text(`From: ${snapshot.originatorName}, ${snapshot.originatorPosition}, ${snapshot.entityName}`);
    doc.text(`Subject: ${snapshot.title}`);
    doc.text(`Date: ${formatLagosDate(snapshot.memoDate)}    Ref: ${snapshot.referenceNumber}`);
    doc.moveDown();
    doc.font('Helvetica-Bold').text('Background');
    doc.font('Helvetica').text(snapshot.background || '—');
    doc.moveDown(0.4);
    doc.font('Helvetica-Bold').text('Justification');
    doc.font('Helvetica').text(snapshot.justification || '—');
    doc.moveDown(0.5);
    doc.font('Helvetica-Bold').text('Items (no prices)');
    doc.font('Helvetica');
    for (const line of snapshot.lines) {
      doc.text(`${line.lineNumber}. ${line.description} — ${line.quantity} ${line.unitCode}`);
    }
    doc.moveDown(0.4);
    doc.text(`Required date: ${formatLagosDate(snapshot.requiredDate)}`);
    doc.text(`Urgency: ${snapshot.urgency}`);
    doc.text(`Delivery: ${snapshot.deliveryLocation}`);
    doc.moveDown(0.4);
    doc.font('Helvetica-Bold').text(`Prayer: ${snapshot.prayer}`);
    doc.moveDown(0.8);

    const stampCells: MemoStamp[] =
      stamps ??
      memoStamps({
        originatorName: snapshot.originatorName,
        originatorPosition: snapshot.originatorPosition,
        templateVersion: 3,
        includeOperations: false,
      }).slice(0, 2);
    const cellW = pageWidth / 3 - 6;
    const cellH = 78;
    stampCells.forEach((stamp, index) => {
      const col = index % 3;
      const rowIndex = Math.floor(index / 3);
      const cx = startX + col * (cellW + 9);
      const cy = doc.y + rowIndex * (cellH + 8);
      doc.strokeColor('#dcdfe3').rect(cx, cy, cellW, cellH).stroke();
      doc.fillColor('#5b646e').font('Helvetica-Bold').fontSize(7).text(stamp.label, cx + 4, cy + 40, {
        width: cellW - 8,
        align: 'center',
      });
      if (stamp.name) {
        doc.fillColor(ink).font('Helvetica-Bold').fontSize(8).text(stamp.name, cx + 4, cy + 52, {
          width: cellW - 8,
          align: 'center',
        });
      } else {
        doc.fillColor('#7c8590').font('Helvetica').fontSize(8).text('Pending', cx + 4, cy + 54, {
          width: cellW - 8,
          align: 'center',
        });
      }
    });
    doc.end();
  });
}
