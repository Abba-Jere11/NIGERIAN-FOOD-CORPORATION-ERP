import { formatKobo } from './money';
import { formatLagosDate } from './datetime';
import { ORGANIZATION_NAME, ROLES, isRoleKey } from './org';
import { PAYMENT_TIMING_LABELS, isPaymentTiming, type ProcurementMemoSnapshot } from './procurement';
import type { RequisitionMemoSnapshot } from './requisitions';
import type { SealAction } from './seals';

export interface MemoStamp {
  label: string;
  name: string | null;
  role: string | null;
}

export interface MemoStampSealInput {
  action: SealAction;
  approverName: string;
  approverRole: string | null;
  approverRoleLabel: string | null;
  occurredAt: string;
}

function roleLabel(seal: MemoStampSealInput): string | null {
  if (seal.approverRoleLabel) return seal.approverRoleLabel;
  if (seal.approverRole && isRoleKey(seal.approverRole)) return ROLES[seal.approverRole].name;
  return seal.approverRole;
}

function stamp(
  label: string,
  seal: MemoStampSealInput | undefined,
  fallbackName: string | null = null,
  fallbackRole: string | null = null,
): MemoStamp {
  return {
    label,
    name: seal?.approverName ?? fallbackName,
    role: seal ? roleLabel(seal) : fallbackRole,
  };
}

/** Live overlay of approval stamps. Frozen snapshot JSON is unchanged. */
export function memoStamps(input: {
  originatorName: string;
  originatorPosition: string;
  seals?: MemoStampSealInput[];
  financeReviewerName?: string | null;
  financeReviewerRole?: string | null;
  templateVersion?: number;
  includeOperations?: boolean;
}): MemoStamp[] {
  const seals = [...(input.seals ?? [])].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const submitted = seals.find((seal) => seal.action === 'submitted');
  const approved = seals.filter((seal) => seal.action === 'approved');
  const paid = [...seals].reverse().find((seal) => seal.action === 'paid');
  const verified = [...seals].reverse().find((seal) => seal.action === 'verified');
  if ((input.templateVersion ?? 2) >= 3) {
    const need = seals.find((seal) => seal.action === 'need_approved');
    const prepared = seals.find((seal) => seal.action === 'prepared');
    const opsReviewed = seals.find((seal) => seal.action === 'operations_reviewed');
    const procurementApproved = seals.find((seal) => seal.action === 'procurement_approved');
    const finance = seals.find((seal) => seal.action === 'approved');
    const cells = [
      stamp('REQUESTED BY', submitted, input.originatorName, input.originatorPosition),
      stamp('NEED APPROVED', need),
      stamp('PREPARED BY', prepared),
    ];
    if (input.includeOperations !== false) {
      cells.push(stamp('OPERATIONS REVIEWED', opsReviewed));
    }
    cells.push(
      stamp('PROCUREMENT APPROVED', procurementApproved),
      stamp('FINANCE APPROVED', finance, input.financeReviewerName ?? null, input.financeReviewerRole ?? null),
      stamp('PAID BY', paid),
      stamp('DELIVERY VERIFIED', verified),
    );
    return cells;
  }
  const ops = approved[0];
  const md = approved[1];
  const finance = approved[2];
  return [
    stamp('REQUESTED BY', submitted, input.originatorName, input.originatorPosition),
    stamp('REVIEWED BY', ops),
    stamp('APPROVED BY', md),
    stamp('FINANCE APPROVED', finance, input.financeReviewerName ?? null, input.financeReviewerRole ?? null),
    stamp('PAID BY', paid),
    stamp('DELIVERY VERIFIED', verified),
  ];
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function row(label: string, value: string): string {
  return `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`;
}

function invoiceList(snapshot: ProcurementMemoSnapshot): string {
  const quotations = snapshot.quotationComparison?.quotations ?? [];
  const items = [
    ...quotations.map(
      (quote) =>
        `<li>${escapeHtml(quote.documentReference ?? 'Quotation')} — quotation from ${escapeHtml(quote.vendorName)} for ${escapeHtml(formatKobo(BigInt(quote.amountKobo)))}</li>`,
    ),
    ...snapshot.invoices.map(
      (invoice) =>
        `<li>${escapeHtml(invoice.documentReference)} — invoice ${escapeHtml(invoice.invoiceNumber)} dated ${escapeHtml(formatLagosDate(invoice.invoiceDate))} for ${escapeHtml(formatKobo(BigInt(invoice.amountKobo)))} (SHA-256 ${escapeHtml(invoice.sha256.slice(0, 12))}…)</li>`,
    ),
  ];
  const invoiceNote =
    quotations.length > 0 && snapshot.invoices.length === 0
      ? '<p>Invoice: requested from the selected vendor at the ED Finance stage.</p>'
      : '';
  if (items.length === 0) return '<p>None attached.</p>';
  return `<ul>${items.join('')}</ul>${invoiceNote}`;
}

function vendorContact(snapshot: ProcurementMemoSnapshot): string {
  return [snapshot.vendor.contactName, snapshot.vendor.contactPhone, snapshot.vendor.contactEmail]
    .filter(Boolean)
    .join(' · ');
}

function stampSvg(pending: boolean): string {
  if (pending) {
    return `<svg class="stamp pending" viewBox="0 0 56 56" width="48" height="48" aria-hidden="true">
      <circle cx="28" cy="28" r="24" fill="none" stroke="#b9bfc6" stroke-width="1.5" stroke-dasharray="4 3"/>
      <circle cx="28" cy="28" r="18" fill="none" stroke="#dcdfe3" stroke-width="1" stroke-dasharray="3 3"/>
    </svg>`;
  }
  return `<svg class="stamp applied" viewBox="0 0 56 56" width="48" height="48" aria-hidden="true">
    <g transform="rotate(-12 28 28)">
      <circle cx="28" cy="28" r="24" fill="none" stroke="#0b4f3a" stroke-width="2"/>
      <circle cx="28" cy="28" r="18" fill="none" stroke="#0b4f3a" stroke-width="1.5"/>
      <path d="M17 29 l8 8 14-16" fill="none" stroke="#0b4f3a" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
    </g>
  </svg>`;
}

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

function memoBudgetLabel(snapshot: ProcurementMemoSnapshot): string {
  const unique = [
    ...new Map(
      (snapshot.lines ?? [])
        .filter((line) => line.budgetLineCode)
        .map((line) => [line.budgetLineCode, `${line.budgetLineCode} — ${line.budgetLineName}`]),
    ).values(),
  ];
  if (unique.length > 0) return unique.join('; ');
  return `${snapshot.budgetLineCode} — ${snapshot.budgetLineName}`;
}

function stampCell(label: string, name: string | null, role: string | null): string {
  const pending = !name;
  return `<div class="stamp-cell${pending ? ' is-pending' : ''}">
    ${stampSvg(pending)}
    <p class="stamp-label">${escapeHtml(label)}</p>
    ${
      pending
        ? '<p class="stamp-pending">Pending</p>'
        : `<p class="stamp-name">${escapeHtml(name)}</p><p class="stamp-role">${escapeHtml(role ?? '')}</p>`
    }
  </div>`;
}

/** Official memo HTML from a structured snapshot. No free-text memo field. */
export function renderProcurementMemoHtml(
  snapshot: ProcurementMemoSnapshot,
  stamps?: MemoStamp[],
): string {
  return snapshot.templateVersion >= 2
    ? renderProcurementMemoHtmlV2(snapshot, stamps)
    : renderProcurementMemoHtmlV1(snapshot);
}

export function renderProcurementMemoHtmlV1(snapshot: ProcurementMemoSnapshot): string {
  const invoices = invoiceList(snapshot);
  const contact = vendorContact(snapshot);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>MEMORANDUM ${escapeHtml(snapshot.referenceNumber)}</title>
  <style>
    body { font-family: Georgia, "Times New Roman", serif; color: #111; margin: 32px; font-size: 13px; }
    .brand { text-align: center; margin-bottom: 8px; }
    .brand img { width: 72px; height: 72px; object-fit: contain; }
    h1 { font-size: 18px; letter-spacing: 0.12em; text-align: center; margin: 0; }
    h2 { font-size: 14px; text-align: center; margin: 4px 0 16px; font-weight: normal; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0; }
    th { text-align: left; width: 32%; padding: 4px 8px 4px 0; vertical-align: top; color: #333; }
    td { padding: 4px 0; vertical-align: top; }
    .block { margin: 16px 0; }
    .seal { border: 1px solid #111; padding: 12px; margin-top: 24px; }
  </style>
</head>
<body>
  <div class="brand"><img src="/nfc-logo.png" alt="Nigeria Food Corporation Logo" width="72" height="72" /></div>
  <h1>${escapeHtml(ORGANIZATION_NAME)}</h1>
  <h2>MEMORANDUM · ${escapeHtml(snapshot.referenceNumber)} · ${escapeHtml(formatLagosDate(snapshot.memoDate))}</h2>
  <p><strong>From:</strong> ${escapeHtml(snapshot.originatorName)}, ${escapeHtml(snapshot.originatorPosition)}, ${escapeHtml(snapshot.entityName)} (${escapeHtml(snapshot.entityCode)})</p>
  <p><strong>Subject:</strong> ${escapeHtml(snapshot.subject)}</p>
  <div class="block">
    <table>
      ${row('Title', snapshot.title)}
      ${row('Department', snapshot.departmentName)}
      ${row('Category', snapshot.categoryName)}
      ${row('Quantity', `${snapshot.quantity} ${snapshot.unitName} (${snapshot.unitCode})`)}
      ${row('Unit price', moneyOrDash(snapshot.unitPriceKobo))}
      ${row('Total', moneyOrDash(snapshot.totalAmountKobo))}
      ${row('Amount in words', snapshot.totalAmountKobo > 0 ? snapshot.amountInWords : '—')}
      ${row('Required date', formatLagosDate(snapshot.requiredDate))}
      ${row('Urgency', snapshot.urgency)}
    </table>
  </div>
  <div class="block">
    <p><strong>Reason</strong></p>
    <p>${escapeHtml(snapshot.reason)}</p>
    <p><strong>Description</strong></p>
    <p>${escapeHtml(snapshot.description)}</p>
  </div>
  <div class="block">
    <p><strong>Vendor</strong></p>
    <table>
      ${row('Name', snapshot.vendor.name)}
      ${row('CAC', snapshot.vendor.cac)}
      ${row('Contact', contact || '—')}
    </table>
  </div>
  <div class="block">
    <p><strong>Budget and funding</strong></p>
    <table>
      ${row('Funding source', snapshot.fundingSource)}
      ${row('Proposed payment timing', proposedTimingLabel(snapshot))}
      ${row('Budget line', `${snapshot.budgetLineCode} — ${snapshot.budgetLineName}`)}
      ${row('Approved', formatKobo(BigInt(snapshot.budgetApprovedKobo)))}
      ${row('Available at generation', formatKobo(BigInt(snapshot.budgetAvailableKobo)))}
      ${row('Project', snapshot.projectCode ? `${snapshot.projectCode} — ${snapshot.projectName ?? ''}` : '—')}
    </table>
  </div>
  <div class="block">
    <table>
      ${row('Delivery location', snapshot.deliveryLocation)}
      ${row('Additional instructions', snapshot.additionalInstructions || '—')}
    </table>
  </div>
  <div class="block">
    <p><strong>Attached documents</strong></p>
    ${invoices}
  </div>
  <div class="seal">
    <p><strong>SEAL BLOCK</strong></p>
    <p>REQUESTED BY — General Manager — ${escapeHtml(snapshot.entityName)} — ${escapeHtml(ORGANIZATION_NAME)}</p>
    <p>The cryptographic seal is applied on submission and verified on every view.</p>
  </div>
</body>
</html>`;
}

/** Vendor quotations side by side, the best-price recommendation and the award. */
function quotationComparisonBlock(snapshot: ProcurementMemoSnapshot): string {
  const comparison = snapshot.quotationComparison;
  if (!comparison || comparison.quotations.length === 0) return '';
  const recommended = comparison.quotations.filter((quote) => quote.recommended);
  const selected = comparison.quotations.find((quote) => quote.selected);
  const rows = comparison.quotations
    .map((quote, index) => {
      const itemRows = (quote.lines ?? [])
        .map(
          (line) =>
            `<div>${escapeHtml(line.description || `Item ${line.lineNumber}`)} · ${escapeHtml(formatKobo(BigInt(line.unitPriceKobo)))} × ${line.quantity} ${escapeHtml(line.unitCode)} = ${escapeHtml(formatKobo(BigInt(line.lineAmountKobo)))}</div>`,
        )
        .join('');
      const unitCell =
        itemRows.length > 0
          ? itemRows
          : escapeHtml(moneyOrDash(quote.unitPriceKobo ?? 0));
      return `<tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(quote.vendorName)}${quote.vendorReference ? ` (${escapeHtml(quote.vendorReference)})` : ''}</td>
        <td>${unitCell}</td>
        <td class="num">${escapeHtml(formatKobo(BigInt(quote.amountKobo)))}</td>
        <td>${escapeHtml(quote.documentReference ?? '—')}</td>
        <td>${[quote.recommended ? 'Best price' : '', quote.selected ? 'Selected' : ''].filter(Boolean).join(' · ') || '—'}</td>
      </tr>`;
    })
    .join('');
  const recommendation =
    recommended.length > 0
      ? `${recommended.map((quote) => quote.vendorName).join(', ')} at ${formatKobo(BigInt(recommended[0]!.amountKobo))}`
      : '—';
  return `<div class="block">
    <p><strong>Price comparison</strong></p>
    <table class="lines">
      <thead>
        <tr>
          <th>S/N</th>
          <th>Vendor</th>
          <th>Items</th>
          <th class="num">Quoted total</th>
          <th>Quotation</th>
          <th>Remark</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <table class="meta">
      ${row('Recommendation (best price)', recommendation)}
      ${row('Selected vendor', selected ? `${selected.vendorName} at ${formatKobo(BigInt(selected.amountKobo))}` : '—')}
      ${comparison.selectionJustification ? row('Justification for selection', comparison.selectionJustification) : ''}
    </table>
  </div>`;
}

export function renderProcurementMemoHtmlV2(
  snapshot: ProcurementMemoSnapshot,
  stamps?: MemoStamp[],
): string {
  const invoices = invoiceList(snapshot);
  const contact = vendorContact(snapshot);
  const lineRows = memoLineRows(snapshot);
  const from = `${snapshot.originatorName}, ${snapshot.originatorPosition}, ${snapshot.entityName} (${snapshot.entityCode})`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>MEMORANDUM ${escapeHtml(snapshot.referenceNumber)}</title>
  <style>
    body { font-family: Georgia, "Times New Roman", serif; color: #14181c; margin: 28px; font-size: 13px; }
    .letterhead { display: flex; align-items: center; gap: 12px; border-bottom: 3px solid #0b4f3a; padding-bottom: 10px; margin-bottom: 16px; }
    .letterhead img { width: 48px; height: 48px; object-fit: contain; }
    .letterhead h1 { font-size: 18px; letter-spacing: 0.08em; margin: 0; color: #06301f; text-transform: uppercase; }
    .letterhead p { margin: 2px 0 0; font-size: 11px; color: #5b646e; letter-spacing: 0.12em; text-transform: uppercase; }
    .header { width: 100%; border-collapse: collapse; margin: 0 0 16px; }
    .header th, .header td { border: 1px solid #14181c; padding: 6px 8px; vertical-align: top; }
    .header th { width: 18%; text-align: left; background: #f1f7f4; color: #06301f; font-size: 11px; }
    .lines { width: 100%; border-collapse: collapse; margin: 12px 0 6px; }
    .lines th, .lines td { border: 1px solid #14181c; padding: 6px 8px; }
    .lines th { background: #0b4f3a; color: #fff; font-size: 11px; text-align: left; }
    .lines td.num, .lines th.num { text-align: right; font-variant-numeric: tabular-nums; }
    .lines tfoot td { font-weight: 700; background: #f1f7f4; }
    .words { margin: 0 0 14px; }
    .prayer { margin: 16px 0; }
    .block { margin: 16px 0; }
    .meta { width: 100%; border-collapse: collapse; }
    .meta th { text-align: left; width: 32%; padding: 3px 8px 3px 0; color: #333a42; }
    .stamps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 20px; }
    .stamp-cell { border: 1px solid #dcdfe3; padding: 8px; text-align: center; min-height: 110px; }
    .stamp-cell.is-pending { background: #fafafa; }
    .stamp-label { font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: #5b646e; margin: 4px 0 2px; }
    .stamp-name { font-size: 12px; font-weight: 700; margin: 0; }
    .stamp-role { font-size: 11px; color: #5b646e; margin: 0; }
    .stamp-pending { font-size: 12px; color: #7c8590; margin: 0; font-style: italic; }
  </style>
</head>
<body>
  <header class="letterhead">
    <img src="/nfc-logo.png" alt="Nigeria Food Corporation Logo" width="48" height="48" />
    <div>
      <h1>${escapeHtml(ORGANIZATION_NAME)}</h1>
      <p>Internal memorandum</p>
    </div>
  </header>
  <table class="header">
    ${row('To', 'Executive Director, Operations')}
    ${row('From', from)}
    ${row('Subject', snapshot.subject)}
    ${row('Date', formatLagosDate(snapshot.memoDate))}
    ${row('Reference', snapshot.referenceNumber)}
  </table>
  <p><strong>Background.</strong> ${escapeHtml(snapshot.reason)}</p>
  <p>${escapeHtml(snapshot.description)}</p>
  <table class="lines">
    <thead>
      <tr>
        <th>S/N</th>
        <th>Description</th>
        <th class="num">Price</th>
        <th class="num">Qty</th>
        <th class="num">Amount</th>
      </tr>
    </thead>
    <tbody>
      ${lineRows
        .map(
          (line) => `<tr>
        <td>${escapeHtml(line.sn)}</td>
        <td>${escapeHtml(line.description)}</td>
        <td class="num">${escapeHtml(line.price)}</td>
        <td class="num">${escapeHtml(line.qty)}</td>
        <td class="num">${escapeHtml(line.amount)}</td>
      </tr>`,
        )
        .join('')}
    </tbody>
    <tfoot>
      <tr>
        <td colspan="4">TOTAL</td>
        <td class="num">${escapeHtml(moneyOrDash(snapshot.totalAmountKobo))}</td>
      </tr>
    </tfoot>
  </table>
  ${
    snapshot.totalAmountKobo > 0
      ? `<p class="words"><strong>Amount in words:</strong> ${escapeHtml(snapshot.amountInWords)}</p>
  <p class="prayer"><strong>Prayer:</strong> We kindly request approval for the sum of ${escapeHtml(snapshot.amountInWords)} (${escapeHtml(formatKobo(BigInt(snapshot.totalAmountKobo)))}).</p>`
      : `<p class="prayer"><strong>Prayer:</strong> We kindly request approval of the selected vendor quotation. Line prices will be applied from that quotation on Managing Director approval.</p>`
  }
  <div class="block">
    <p><strong>Budget and funding</strong></p>
    <table class="meta">
      ${row('Funding source', snapshot.fundingSource)}
      ${row('Proposed payment timing', proposedTimingLabel(snapshot))}
      ${row('Budget line', memoBudgetLabel(snapshot))}
      ${row('Approved', formatKobo(BigInt(snapshot.budgetApprovedKobo)))}
      ${row('Available at generation', formatKobo(BigInt(snapshot.budgetAvailableKobo)))}
      ${row('Project', snapshot.projectCode ? `${snapshot.projectCode} — ${snapshot.projectName ?? ''}` : '—')}
    </table>
  </div>
  ${quotationComparisonBlock(snapshot)}
  <div class="block">
    <p><strong>Vendor</strong></p>
    <table class="meta">
      ${row('Name', snapshot.vendor.name)}
      ${row('CAC', snapshot.vendor.cac)}
      ${row('Contact', contact || '—')}
    </table>
  </div>
  <div class="block">
    <p><strong>Attached documents</strong></p>
    ${invoices}
  </div>
  <div class="stamps">
    ${(
      stamps ??
      memoStamps({
        originatorName: snapshot.originatorName,
        originatorPosition: snapshot.originatorPosition,
        templateVersion: snapshot.templateVersion,
      })
    )
      .map((stamp) => stampCell(stamp.label, stamp.name, stamp.role))
      .join('')}
  </div>
</body>
</html>`;
}

export function renderRequisitionMemoHtml(
  snapshot: RequisitionMemoSnapshot,
  stamps?: MemoStamp[],
): string {
  const lineRows = snapshot.lines
    .map(
      (line) => `<tr>
        <td>${escapeHtml(String(line.lineNumber))}</td>
        <td>${escapeHtml(line.description)}</td>
        <td class="num">${escapeHtml(String(line.quantity))}</td>
        <td>${escapeHtml(line.unitName)} (${escapeHtml(line.unitCode)})</td>
      </tr>`,
    )
    .join('');
  const from = `${snapshot.originatorName}, ${snapshot.originatorPosition}, ${snapshot.entityName} (${snapshot.entityCode})`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>MEMORANDUM ${escapeHtml(snapshot.referenceNumber)}</title>
  <style>
    body { font-family: Georgia, "Times New Roman", serif; color: #14181c; margin: 28px; font-size: 13px; }
    .letterhead { display: flex; align-items: center; gap: 12px; border-bottom: 3px solid #0b4f3a; padding-bottom: 10px; margin-bottom: 16px; }
    .letterhead img { width: 48px; height: 48px; object-fit: contain; }
    .letterhead h1 { font-size: 18px; letter-spacing: 0.08em; margin: 0; color: #06301f; text-transform: uppercase; }
    .letterhead p { margin: 2px 0 0; font-size: 11px; color: #5b646e; letter-spacing: 0.12em; text-transform: uppercase; }
    .header { width: 100%; border-collapse: collapse; margin: 0 0 16px; }
    .header th, .header td { border: 1px solid #14181c; padding: 6px 8px; vertical-align: top; }
    .header th { width: 18%; text-align: left; background: #f1f7f4; color: #06301f; font-size: 11px; }
    .lines { width: 100%; border-collapse: collapse; margin: 12px 0 6px; }
    .lines th, .lines td { border: 1px solid #14181c; padding: 6px 8px; }
    .lines th { background: #0b4f3a; color: #fff; font-size: 11px; text-align: left; }
    .lines td.num, .lines th.num { text-align: right; font-variant-numeric: tabular-nums; }
    .prayer { margin: 16px 0; }
    .stamps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 20px; }
    .stamp-cell { border: 1px solid #dcdfe3; padding: 8px; text-align: center; min-height: 110px; }
    .stamp-cell.is-pending { background: #fafafa; }
    .stamp-label { font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: #5b646e; margin: 4px 0 2px; }
    .stamp-name { font-size: 12px; font-weight: 700; margin: 0; }
    .stamp-role { font-size: 11px; color: #5b646e; margin: 0; }
    .stamp-pending { font-size: 12px; color: #7c8590; margin: 0; font-style: italic; }
  </style>
</head>
<body>
  <header class="letterhead">
    <img src="/nfc-logo.png" alt="Nigeria Food Corporation Logo" width="48" height="48" />
    <div>
      <h1>${escapeHtml(ORGANIZATION_NAME)}</h1>
      <p>Requisition memorandum</p>
    </div>
  </header>
  <table class="header">
    ${row('To', 'Managing Director')}
    ${row('From', from)}
    ${row('Subject', snapshot.title)}
    ${row('Date', formatLagosDate(snapshot.memoDate))}
    ${row('Reference', snapshot.referenceNumber)}
  </table>
  <p><strong>Background</strong></p>
  <p>${escapeHtml(snapshot.background)}</p>
  <p><strong>Justification</strong></p>
  <p>${escapeHtml(snapshot.justification)}</p>
  <table class="lines">
    <thead>
      <tr>
        <th>S/N</th>
        <th>Description</th>
        <th class="num">Qty</th>
        <th>Unit</th>
      </tr>
    </thead>
    <tbody>${lineRows}</tbody>
  </table>
  <p>Required date: ${escapeHtml(formatLagosDate(snapshot.requiredDate))} · Urgency: ${escapeHtml(snapshot.urgency)} · Delivery: ${escapeHtml(snapshot.deliveryLocation)}</p>
  <p class="prayer"><strong>Prayer:</strong> ${escapeHtml(snapshot.prayer)}</p>
  <div class="stamps">
    ${(
      stamps ??
      memoStamps({
        originatorName: snapshot.originatorName,
        originatorPosition: snapshot.originatorPosition,
        templateVersion: 3,
        includeOperations: false,
      }).slice(0, 2)
    )
      .map((item) => stampCell(item.label, item.name, item.role))
      .join('')}
  </div>
</body>
</html>`;
}
