import PDFDocument from 'pdfkit';
import {
  ORGANIZATION_NAME,
  PAYMENT_TIMING_LABELS,
  formatKobo,
  formatLagosDate,
  isPaymentTiming,
  memoStamps,
  type MemoStamp,
  type ProcurementMemoSnapshot,
} from '@nfc/shared';

function proposedTimingLabel(snapshot: ProcurementMemoSnapshot): string {
  const value = snapshot.proposedPaymentTiming;
  if (value && isPaymentTiming(value)) return PAYMENT_TIMING_LABELS[value];
  return '—';
}

function moneyOrDash(kobo: number): string {
  return kobo > 0 ? formatKobo(BigInt(kobo)) : '—';
}

function memoLineRows(snapshot: ProcurementMemoSnapshot): Array<{
  sn: string;
  description: string;
  price: string;
  qty: string;
  amount: string;
}> {
  if (snapshot.lines && snapshot.lines.length > 0) {
    return snapshot.lines.map((line) => ({
      sn: String(line.lineNumber),
      description: line.description || line.categoryName || snapshot.title,
      price: moneyOrDash(line.unitPriceKobo),
      qty: `${line.quantity} ${line.unitCode}`,
      amount: moneyOrDash(line.lineAmountKobo),
    }));
  }
  return [
    {
      sn: '1',
      description: snapshot.title,
      price: moneyOrDash(snapshot.unitPriceKobo),
      qty: `${snapshot.quantity} ${snapshot.unitCode}`,
      amount: moneyOrDash(snapshot.totalAmountKobo),
    },
  ];
}
import { nfcLogoPath } from './letterhead-logo';

export function renderProcurementMemoPdf(
  snapshot: ProcurementMemoSnapshot,
  stamps?: MemoStamp[],
): Promise<Buffer> {
  return snapshot.templateVersion >= 2
    ? renderProcurementMemoPdfV2(snapshot, stamps)
    : renderProcurementMemoPdfV1(snapshot);
}

export function renderProcurementMemoPdfV1(snapshot: ProcurementMemoSnapshot): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    drawLetterheadLogo(doc, 56);
    doc.fontSize(14).text(ORGANIZATION_NAME, { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(11).text(`MEMORANDUM  ·  ${snapshot.referenceNumber}  ·  ${formatLagosDate(snapshot.memoDate)}`, {
      align: 'center',
    });
    doc.moveDown();
    doc.fontSize(10);
    line(doc, 'From', `${snapshot.originatorName}, ${snapshot.originatorPosition}, ${snapshot.entityName} (${snapshot.entityCode})`);
    line(doc, 'Subject', snapshot.subject);
    doc.moveDown(0.5);
    line(doc, 'Title', snapshot.title);
    line(doc, 'Department', snapshot.departmentName);
    line(doc, 'Category', snapshot.categoryName);
    line(doc, 'Quantity', `${snapshot.quantity} ${snapshot.unitName} (${snapshot.unitCode})`);
    line(doc, 'Unit price', moneyOrDash(snapshot.unitPriceKobo));
    line(doc, 'Total', moneyOrDash(snapshot.totalAmountKobo));
    line(doc, 'Amount in words', snapshot.amountInWords);
    line(doc, 'Required date', formatLagosDate(snapshot.requiredDate));
    line(doc, 'Urgency', snapshot.urgency);
    doc.moveDown(0.5);
    doc.font('Helvetica-Bold').text('Reason');
    doc.font('Helvetica').text(snapshot.reason);
    doc.moveDown(0.3);
    doc.font('Helvetica-Bold').text('Description');
    doc.font('Helvetica').text(snapshot.description);
    doc.moveDown(0.5);
    doc.font('Helvetica-Bold').text('Vendor');
    doc.font('Helvetica');
    line(doc, 'Name', snapshot.vendor.name);
    line(doc, 'CAC', snapshot.vendor.cac);
    line(
      doc,
      'Contact',
      [snapshot.vendor.contactName, snapshot.vendor.contactPhone, snapshot.vendor.contactEmail]
        .filter(Boolean)
        .join(' · ') || '—',
    );
    doc.moveDown(0.5);
    doc.font('Helvetica-Bold').text('Budget and funding');
    doc.font('Helvetica');
    line(doc, 'Funding source', snapshot.fundingSource);
    line(doc, 'Proposed payment timing', proposedTimingLabel(snapshot));
    line(doc, 'Budget line', `${snapshot.budgetLineCode} — ${snapshot.budgetLineName}`);
    line(doc, 'Approved', formatKobo(BigInt(snapshot.budgetApprovedKobo)));
    line(doc, 'Available at generation', formatKobo(BigInt(snapshot.budgetAvailableKobo)));
    line(
      doc,
      'Project',
      snapshot.projectCode ? `${snapshot.projectCode} — ${snapshot.projectName ?? ''}` : '—',
    );
    line(doc, 'Delivery location', snapshot.deliveryLocation);
    line(doc, 'Additional instructions', snapshot.additionalInstructions || '—');
    doc.moveDown(0.5);
    doc.font('Helvetica-Bold').text('Attached documents');
    doc.font('Helvetica');
    writeInvoices(doc, snapshot);
    doc.moveDown();
    doc.rect(doc.x, doc.y, 500, 64).stroke();
    doc.moveDown(0.4);
    doc.font('Helvetica-Bold').text('SEAL BLOCK');
    doc.font('Helvetica').text(
      `REQUESTED BY — General Manager — ${snapshot.entityName} — ${ORGANIZATION_NAME}`,
    );
    doc.text('The cryptographic seal is applied on submission and verified on every view.');
    doc.end();
  });
}

export function renderProcurementMemoPdfV2(
  snapshot: ProcurementMemoSnapshot,
  stamps?: MemoStamp[],
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 42 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const accent = '#0b4f3a';
    const ink = '#14181c';
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const logo = nfcLogoPath();
    const titleX = logo ? doc.page.margins.left + 52 : doc.page.margins.left;
    if (logo) {
      doc.image(logo, doc.page.margins.left, doc.y, { width: 44, height: 44 });
    }
    const titleY = doc.y;
    doc.fillColor(accent).font('Helvetica-Bold').fontSize(16).text(ORGANIZATION_NAME.toUpperCase(), titleX, titleY, {
      width: pageWidth - (logo ? 52 : 0),
    });
    doc.fillColor('#5b646e').font('Helvetica').fontSize(9).text('INTERNAL MEMORANDUM', titleX, doc.y, {
      width: pageWidth - (logo ? 52 : 0),
    });
    doc.y = Math.max(doc.y, titleY + (logo ? 44 : 0));
    doc.moveTo(doc.page.margins.left, doc.y + 6).lineTo(doc.page.margins.left + pageWidth, doc.y + 6);
    doc.strokeColor(accent).lineWidth(2).stroke();
    doc.moveDown(1.2);

    const from = `${snapshot.originatorName}, ${snapshot.originatorPosition}, ${snapshot.entityName} (${snapshot.entityCode})`;
    headerRow(doc, pageWidth, 'To', 'Executive Director, Operations');
    headerRow(doc, pageWidth, 'From', from);
    headerRow(doc, pageWidth, 'Subject', snapshot.subject);
    headerRow(doc, pageWidth, 'Date', formatLagosDate(snapshot.memoDate));
    headerRow(doc, pageWidth, 'Reference', snapshot.referenceNumber);
    doc.moveDown(0.6);

    doc.fillColor(ink).font('Helvetica-Bold').fontSize(10).text('Background. ', { continued: true });
    doc.font('Helvetica').text(snapshot.reason);
    doc.moveDown(0.3);
    doc.text(snapshot.description);
    doc.moveDown(0.5);

    const cols = [36, 190, 90, 70, 90];
    const headers = ['S/N', 'Description', 'Price', 'Qty', 'Amount'];
    const startX = doc.page.margins.left;
    let x = startX;
    const rowY = doc.y;
    doc.fillColor(accent).rect(startX, rowY, pageWidth, 18).fill();
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8);
    headers.forEach((header, index) => {
      doc.text(header, x + 3, rowY + 5, { width: cols[index]! - 6, align: index >= 2 ? 'right' : 'left' });
      x += cols[index]!;
    });
    doc.y = rowY + 18;

    const lineRows = memoLineRows(snapshot);
    doc.strokeColor(ink).lineWidth(0.6);
    for (const row of lineRows) {
      const itemY = doc.y;
      x = startX;
      const cells = [row.sn, row.description, row.price, row.qty, row.amount];
      cells.forEach((cell, index) => {
        doc.rect(x, itemY, cols[index]!, 22).stroke();
        doc.fillColor(ink).font('Helvetica').fontSize(8).text(cell, x + 3, itemY + 6, {
          width: cols[index]! - 6,
          align: index >= 2 ? 'right' : 'left',
        });
        x += cols[index]!;
      });
      doc.y = itemY + 22;
    }

    const totalY = doc.y;
    doc.rect(startX, totalY, pageWidth - cols[4]!, 18).stroke();
    doc.rect(startX + pageWidth - cols[4]!, totalY, cols[4]!, 18).stroke();
    doc.font('Helvetica-Bold').text('TOTAL', startX + 3, totalY + 5);
    doc.text(moneyOrDash(snapshot.totalAmountKobo), startX + pageWidth - cols[4]! + 3, totalY + 5, {
      width: cols[4]! - 6,
      align: 'right',
    });
    doc.y = totalY + 26;

    if (snapshot.totalAmountKobo > 0) {
      doc.font('Helvetica-Bold').fontSize(9).text('Amount in words: ', { continued: true });
      doc.font('Helvetica').text(snapshot.amountInWords);
      doc.moveDown(0.5);
      doc.font('Helvetica-Bold').text('Prayer: ', { continued: true });
      doc
        .font('Helvetica')
        .text(
          `We kindly request approval for the sum of ${snapshot.amountInWords} (${formatKobo(BigInt(snapshot.totalAmountKobo))}).`,
        );
    } else {
      doc.font('Helvetica-Bold').fontSize(9).text('Prayer: ', { continued: true });
      doc
        .font('Helvetica')
        .text(
          'We kindly request approval of the selected vendor quotation. Line prices will be applied from that quotation on Managing Director approval.',
        );
    }
    doc.moveDown(0.5);

    writeQuotationComparison(doc, snapshot, pageWidth, accent, ink);

    doc.font('Helvetica-Bold').text('Vendor');
    doc.font('Helvetica');
    line(doc, 'Name', snapshot.vendor.name);
    line(doc, 'CAC', snapshot.vendor.cac);
    line(
      doc,
      'Contact',
      [snapshot.vendor.contactName, snapshot.vendor.contactPhone, snapshot.vendor.contactEmail]
        .filter(Boolean)
        .join(' · ') || '—',
    );
    doc.moveDown(0.3);
    doc.font('Helvetica-Bold').text('Budget and funding');
    doc.font('Helvetica');
    line(doc, 'Funding source', snapshot.fundingSource);
    line(doc, 'Proposed payment timing', proposedTimingLabel(snapshot));
    line(doc, 'Budget line', `${snapshot.budgetLineCode} — ${snapshot.budgetLineName}`);
    line(doc, 'Delivery location', snapshot.deliveryLocation);
    doc.moveDown(0.3);
    doc.font('Helvetica-Bold').text('Attached documents');
    doc.font('Helvetica');
    writeInvoices(doc, snapshot);

    doc.moveDown(0.8);
    const stampCells: MemoStamp[] =
      stamps ??
      memoStamps({
        originatorName: snapshot.originatorName,
        originatorPosition: snapshot.originatorPosition,
      });
    const cellW = pageWidth / 3 - 6;
    const cellH = 78;
    stampCells.forEach((stamp, index) => {
      const col = index % 3;
      const rowIndex = Math.floor(index / 3);
      const cx = startX + col * (cellW + 9);
      const cy = doc.y + rowIndex * (cellH + 8);
      doc.strokeColor('#dcdfe3').rect(cx, cy, cellW, cellH).stroke();
      drawStamp(doc, cx + cellW / 2, cy + 22, !stamp.name);
      doc.fillColor('#5b646e').font('Helvetica-Bold').fontSize(7).text(stamp.label, cx + 4, cy + 40, {
        width: cellW - 8,
        align: 'center',
      });
      if (stamp.name) {
        doc.fillColor(ink).font('Helvetica-Bold').fontSize(8).text(stamp.name, cx + 4, cy + 52, {
          width: cellW - 8,
          align: 'center',
        });
        doc.fillColor('#5b646e').font('Helvetica').fontSize(7).text(stamp.role ?? '', cx + 4, cy + 64, {
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

function writeQuotationComparison(
  doc: PDFKit.PDFDocument,
  snapshot: ProcurementMemoSnapshot,
  pageWidth: number,
  accent: string,
  ink: string,
): void {
  const comparison = snapshot.quotationComparison;
  if (!comparison || comparison.quotations.length === 0) return;
  const startX = doc.page.margins.left;
  const cols = [28, pageWidth - 28 - 88 - 72 - 88, 88, 72, 88];
  const headers = ['S/N', 'Vendor', 'Quoted total', 'Quotation', 'Remark'];

  doc.fillColor(ink).font('Helvetica-Bold').fontSize(9).text('Price comparison');
  doc.moveDown(0.2);
  let x = startX;
  const headY = doc.y;
  doc.fillColor(accent).rect(startX, headY, pageWidth, 18).fill();
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8);
  headers.forEach((header, index) => {
    doc.text(header, x + 3, headY + 5, {
      width: cols[index]! - 6,
      align: index === 2 ? 'right' : 'left',
    });
    x += cols[index]!;
  });
  doc.y = headY + 18;
  doc.strokeColor(ink).lineWidth(0.6);
  comparison.quotations.forEach((quote, rowIndex) => {
    const itemLines = quote.lines ?? [];
    const detail =
      itemLines.length > 0
        ? itemLines
            .map(
              (line) =>
                `${line.description || `Item ${line.lineNumber}`}: ${formatKobo(BigInt(line.unitPriceKobo))} × ${line.quantity} ${line.unitCode} = ${formatKobo(BigInt(line.lineAmountKobo))}`,
            )
            .join('\n')
        : quote.unitPriceKobo
          ? `Unit price ${formatKobo(BigInt(quote.unitPriceKobo))}`
          : '';
    const rowHeight = 20 + (detail ? Math.max(itemLines.length, 1) * 11 : 0);
    const rowY = doc.y;
    x = startX;
    const remark = [quote.recommended ? 'Best price' : '', quote.selected ? 'Selected' : ''].filter(Boolean).join(' · ') || '—';
    const vendor = quote.vendorReference ? `${quote.vendorName} (${quote.vendorReference})` : quote.vendorName;
    const vendorCell = detail ? `${vendor}\n${detail}` : vendor;
    const cells = [
      String(rowIndex + 1),
      vendorCell,
      formatKobo(BigInt(quote.amountKobo)),
      quote.documentReference ?? '—',
      remark,
    ];
    cells.forEach((cell, index) => {
      doc.rect(x, rowY, cols[index]!, rowHeight).stroke();
      doc.fillColor(ink).font(index === 4 && quote.recommended ? 'Helvetica-Bold' : 'Helvetica').fontSize(8).text(
        cell,
        x + 3,
        rowY + 6,
        { width: cols[index]! - 6, align: index === 2 ? 'right' : 'left' },
      );
      x += cols[index]!;
    });
    doc.y = rowY + rowHeight;
  });
  doc.x = startX;
  doc.moveDown(0.4);
  const recommended = comparison.quotations.filter((quote) => quote.recommended);
  const selected = comparison.quotations.find((quote) => quote.selected);
  doc.fontSize(9);
  line(
    doc,
    'Recommendation (best price)',
    recommended.length > 0
      ? `${recommended.map((quote) => quote.vendorName).join(', ')} at ${formatKobo(BigInt(recommended[0]!.amountKobo))}`
      : '—',
  );
  line(doc, 'Selected vendor', selected ? `${selected.vendorName} at ${formatKobo(BigInt(selected.amountKobo))}` : '—');
  if (comparison.selectionJustification) line(doc, 'Justification for selection', comparison.selectionJustification);
  doc.moveDown(0.4);
}

function writeInvoices(doc: PDFKit.PDFDocument, snapshot: ProcurementMemoSnapshot): void {
  const quotations = snapshot.quotationComparison?.quotations ?? [];
  if (snapshot.invoices.length === 0 && quotations.length === 0) {
    doc.text('None attached.');
    return;
  }
  for (const quote of quotations) {
    doc.text(
      `${quote.documentReference ?? 'Quotation'} — quotation from ${quote.vendorName} for ${formatKobo(BigInt(quote.amountKobo))}`,
    );
  }
  for (const invoice of snapshot.invoices) {
    doc.text(
      `${invoice.documentReference} — invoice ${invoice.invoiceNumber} dated ${formatLagosDate(invoice.invoiceDate)} for ${formatKobo(BigInt(invoice.amountKobo))} (SHA-256 ${invoice.sha256.slice(0, 12)}…)`,
    );
  }
  if (quotations.length > 0 && snapshot.invoices.length === 0) {
    doc.text('Invoice: requested from the selected vendor at the ED Finance stage.');
  }
}

function line(doc: PDFKit.PDFDocument, label: string, value: string): void {
  doc.font('Helvetica-Bold').text(`${label}: `, { continued: true });
  doc.font('Helvetica').text(value);
}

function headerRow(doc: PDFKit.PDFDocument, pageWidth: number, label: string, value: string): void {
  const y = doc.y;
  const labelW = 88;
  doc.strokeColor('#14181c').lineWidth(0.7);
  doc.rect(doc.page.margins.left, y, labelW, 18).stroke();
  doc.rect(doc.page.margins.left + labelW, y, pageWidth - labelW, 18).stroke();
  doc.fillColor('#06301f').font('Helvetica-Bold').fontSize(8).text(label, doc.page.margins.left + 4, y + 5, {
    width: labelW - 8,
  });
  doc.fillColor('#14181c').font('Helvetica').fontSize(8).text(value, doc.page.margins.left + labelW + 4, y + 5, {
    width: pageWidth - labelW - 8,
  });
  doc.y = y + 18;
}

function drawLetterheadLogo(doc: PDFKit.PDFDocument, size: number): void {
  const logo = nfcLogoPath();
  if (!logo) return;
  const x = doc.page.margins.left + (doc.page.width - doc.page.margins.left - doc.page.margins.right - size) / 2;
  doc.image(logo, x, doc.y, { width: size, height: size });
  doc.y += size + 8;
}

function drawStamp(doc: PDFKit.PDFDocument, cx: number, cy: number, pending: boolean): void {
  doc.save();
  doc.translate(cx, cy);
  if (pending) {
    doc.rotate(-8);
    doc.strokeColor('#b9bfc6').lineWidth(1).undash();
    doc.circle(0, 0, 14).dash(2, { space: 2 }).stroke();
    doc.circle(0, 0, 10).stroke();
    doc.undash();
  } else {
    doc.rotate(-12);
    doc.strokeColor('#0b4f3a').lineWidth(1.4).circle(0, 0, 14).stroke();
    doc.lineWidth(1).circle(0, 0, 10).stroke();
    doc.lineWidth(1.6).moveTo(-7, 1).lineTo(-2, 6).lineTo(8, -6).stroke();
  }
  doc.restore();
}
