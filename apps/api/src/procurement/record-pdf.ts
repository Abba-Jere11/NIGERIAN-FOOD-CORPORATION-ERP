import PDFDocument from 'pdfkit';
import type { ProcurementView } from '@nfc/shared';
import { ORGANIZATION_NAME, formatKobo, formatLagosDate } from '@nfc/shared';
import { nfcLogoPath } from './letterhead-logo';

export function renderProcurementRecordPdf(view: ProcurementView): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const logo = nfcLogoPath();
    if (logo) {
      const size = 48;
      const x = doc.page.margins.left + (doc.page.width - doc.page.margins.left - doc.page.margins.right - size) / 2;
      doc.image(logo, x, doc.y, { width: size, height: size });
      doc.y += size + 8;
    }
    doc.fontSize(13).text(ORGANIZATION_NAME, { align: 'center' });
    doc.moveDown(0.2);
    doc.fontSize(11).text(`PROCUREMENT RECORD  ·  ${view.referenceNumber}`, { align: 'center' });
    doc.moveDown();
    doc.fontSize(10);
    line(doc, 'Subject', view.subject ?? view.title);
    line(doc, 'Subsidiary', `${view.entityName ?? ''} (${view.entityCode ?? ''})`);
    line(
      doc,
      'Amount',
      view.totalAmountKobo == null ? '—' : formatKobo(BigInt(view.totalAmountKobo)),
    );
    line(doc, 'Status', view.status);
    doc.moveDown(0.4);
    for (const step of view.progress) {
      tick(doc, `${step.label} (${step.responsible})`, step.state === 'done');
    }
    if (view.nextAction) {
      doc.moveDown(0.2);
      line(doc, 'Next action', `${view.nextAction.label} — ${view.nextAction.responsible}`);
    }
    doc.moveDown(0.5);
    doc.fontSize(11).text('Version / return history');
    doc.fontSize(9);
    for (const version of view.versions) {
      doc.text(
        `Version ${version.versionNumber}${version.submittedAt ? ` submitted ${formatLagosDate(version.submittedAt)}` : ' draft'}${version.returnReason ? ` — returned: ${version.returnReason}` : ''}${version.rejectReason ? ` — rejected: ${version.rejectReason}` : ''}`,
      );
    }
    if (view.receipts.length > 0) {
      doc.moveDown(0.4);
      doc.fontSize(11).text('Goods received');
      doc.fontSize(9);
      for (const delivery of view.deliveries) {
        doc.font('Helvetica-Bold').text(
          `${delivery.referenceNumber} · ${formatLagosDate(delivery.receivedDate)} · ${delivery.location} · ${delivery.documentKind.replaceAll('_', ' ')}`,
        );
        doc.font('Helvetica');
        for (const item of delivery.items) {
          doc.text(
            `   Item ${item.lineNumber ?? '—'} ${item.description ?? ''}: ordered ${item.quantityOrdered}, received ${item.quantityReceived}, accepted ${item.quantityAccepted}, rejected ${item.quantityRejected}${item.rejectReason ? ` — ${item.rejectReason}` : ''}${item.superseded ? ' (corrected)' : ''}`,
          );
        }
      }
      for (const receipt of view.receipts.filter((item) => !item.deliveryId)) {
        doc.text(
          `${receipt.referenceNumber} · item ${receipt.lineNumber ?? '—'} · received ${receipt.quantityReceived}, accepted ${receipt.quantityAccepted} of ${receipt.quantityOrdered}, rejected ${receipt.quantityRejected} on ${formatLagosDate(receipt.receivedDate)}`,
        );
      }
    }
    if (view.closeShort) {
      doc.moveDown(0.4);
      doc.fontSize(11).text('Close-short');
      doc.fontSize(9);
      const cs = view.closeShort;
      line(
        doc,
        'Reference',
        cs.referenceNumber ?? cs.id,
      );
      line(doc, 'Status', cs.status);
      line(
        doc,
        'Outstanding',
        `${cs.outstandingQuantity} units · ${formatKobo(BigInt(cs.outstandingAmountKobo))}`,
      );
      line(doc, 'GM request reason', cs.reason);
      line(doc, 'Requested', formatLagosDate(cs.createdAt));
      if (cs.approvals.length > 0) {
        doc.moveDown(0.2);
        doc.font('Helvetica-Bold').text('Approvals');
        doc.font('Helvetica');
        for (const approval of cs.approvals) {
          const detail = approval.reason ? ` — ${approval.reason}` : '';
          doc.text(
            `${approval.stageLabel}: ${approval.action} by ${approval.actorName} on ${formatLagosDate(approval.occurredAt)}${detail}`,
          );
        }
      }
      if (cs.vendorOpenClaim) {
        doc.moveDown(0.2);
        line(
          doc,
          'Vendor open claim',
          `${cs.vendorOpenClaim.quantity} units · ${formatKobo(BigInt(cs.vendorOpenClaim.amountKobo))}`,
        );
        line(doc, 'Claim reason', cs.vendorOpenClaim.reason);
      }
    }
    doc.end();
  });
}

function line(doc: PDFKit.PDFDocument, label: string, value: string): void {
  doc.font('Helvetica-Bold').text(`${label}: `, { continued: true });
  doc.font('Helvetica').text(value || '—');
}

function tick(doc: PDFKit.PDFDocument, label: string, done: boolean): void {
  doc.text(`${done ? '✓' : '○'}  ${label}`);
}
