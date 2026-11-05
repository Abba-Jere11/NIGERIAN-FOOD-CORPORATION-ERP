import { describe, expect, it } from 'vitest';
import { memoStamps, renderProcurementMemoHtml } from './memo-html';
import type { ProcurementMemoSnapshot } from './procurement';

function sample(version: number): ProcurementMemoSnapshot {
  return {
    templateVersion: version,
    referenceNumber: 'PR-2026-000186',
    title: 'Conveyor idlers',
    subject: 'Replacement rollers',
    memoDate: '2026-10-01T00:00:00.000Z',
    originatorName: 'Musa Ibrahim',
    originatorPosition: 'General Manager',
    entityCode: 'YFZ',
    entityName: 'Yobe Fertilizer',
    departmentName: 'Operations',
    categoryName: 'Services',
    reason: 'Worn rollers.',
    description: 'Supply of idlers.',
    quantity: 4,
    unitCode: 'PCS',
    unitName: 'Pieces',
    unitPriceKobo: 250_000,
    totalAmountKobo: 1_000_000,
    amountInWords: 'Ten Thousand Naira Only',
    requiredDate: '2026-12-15',
    vendor: {
      id: 'v',
      name: 'XYZ Limited',
      cac: 'RC-1',
      contactName: null,
      contactPhone: null,
      contactEmail: null,
    },
    deliveryLocation: 'YFZ stores',
    fundingSource: 'Operating',
    budgetLineCode: 'YFZ-CAPEX',
    budgetLineName: 'Capex',
    budgetApprovedKobo: 1,
    budgetAvailableKobo: 1,
    projectCode: null,
    projectName: null,
    urgency: 'NORMAL',
    additionalInstructions: null,
    invoices: [],
    version: 1,
  };
}

describe('memo template versions', () => {
  it('keeps the v1 seal block for frozen snapshots', () => {
    const html = renderProcurementMemoHtml(sample(1));
    expect(html).toContain('SEAL BLOCK');
    expect(html).not.toContain('Prayer:');
  });

  it('renders snapshot.lines in the v2 table and falls back to scalars', () => {
    const withLines = renderProcurementMemoHtml({
      ...sample(2),
      lines: [
        {
          lineNumber: 1,
          description: 'Idlers',
          categoryName: 'Equipment',
          quantity: 2,
          unitCode: 'PCS',
          unitName: 'Pieces',
          unitPriceKobo: 250_000,
          lineAmountKobo: 500_000,
          budgetLineCode: 'YFZ-CAPEX',
          budgetLineName: 'Capex',
        },
        {
          lineNumber: 2,
          description: 'Service visit',
          categoryName: 'Services',
          quantity: 1,
          unitCode: 'JOB',
          unitName: 'Job',
          unitPriceKobo: 500_000,
          lineAmountKobo: 500_000,
          budgetLineCode: 'YFZ-OPEX',
          budgetLineName: 'Opex',
        },
      ],
    });
    expect(withLines).toContain('Idlers');
    expect(withLines).toContain('Service visit');
    expect(withLines).toContain('YFZ-OPEX');
    const fallback = renderProcurementMemoHtml(sample(2));
    expect(fallback).toContain('Conveyor idlers');
  });

  it('renders v2 letterhead, line table, prayer and pending stamps', () => {
    const html = renderProcurementMemoHtml(sample(2));
    expect(html).toContain('Internal memorandum');
    expect(html).toContain('Prayer:');
    expect(html).toContain('REQUESTED BY');
    expect(html).toContain('Pending');
    expect(html).toContain('Ten Thousand Naira Only');
    expect(html).toContain('Conveyor idlers');
    expect(html).toContain('Proposed payment timing');
    expect(html).not.toContain('SEAL BLOCK');
  });

  it('fills reviewed and approved stamp cells from live Ops and MD seals', () => {
    const html = renderProcurementMemoHtml(
      sample(2),
      memoStamps({
        originatorName: 'Musa Ibrahim',
        originatorPosition: 'General Manager',
        seals: [
          {
            action: 'submitted',
            approverName: 'Musa Ibrahim',
            approverRole: 'gm',
            approverRoleLabel: 'General Manager',
            occurredAt: '2026-10-01T08:00:00.000Z',
          },
          {
            action: 'approved',
            approverName: 'Halima Bello',
            approverRole: 'ed_operations',
            approverRoleLabel: 'Executive Director, Operations',
            occurredAt: '2026-10-02T09:00:00.000Z',
          },
          {
            action: 'approved',
            approverName: 'Abubakar Suleiman',
            approverRole: 'md',
            approverRoleLabel: 'Managing Director',
            occurredAt: '2026-10-03T10:00:00.000Z',
          },
        ],
      }),
    );
    expect(html).toContain('Halima Bello');
    expect(html).toContain('Abubakar Suleiman');
    expect(html).toContain('Executive Director, Operations');
    expect(html).toContain('Managing Director');
    const reviewed = html.slice(html.indexOf('REVIEWED BY'));
    expect(reviewed.slice(0, reviewed.indexOf('APPROVED BY'))).not.toContain('Pending');
    const approved = html.slice(html.indexOf('APPROVED BY'));
    expect(approved.slice(0, approved.indexOf('FINANCE APPROVED'))).not.toContain('Pending');
    expect(html).toContain('Pending');
  });

  it('renders v3 7-stamp grid when operations is skipped and 8 when it is present', () => {
    const skipped = memoStamps({
      originatorName: 'Musa Ibrahim',
      originatorPosition: 'General Manager',
      templateVersion: 3,
      includeOperations: false,
      seals: [
        {
          action: 'submitted',
          approverName: 'Musa Ibrahim',
          approverRole: 'gm',
          approverRoleLabel: 'General Manager',
          occurredAt: '2026-10-01T08:00:00.000Z',
        },
        {
          action: 'need_approved',
          approverName: 'Abubakar Suleiman',
          approverRole: 'md',
          approverRoleLabel: 'Managing Director',
          occurredAt: '2026-10-02T09:00:00.000Z',
        },
        {
          action: 'prepared',
          approverName: 'Hauwa Goni',
          approverRole: 'inventory_officer',
          approverRoleLabel: 'Procurement Manager',
          occurredAt: '2026-10-03T10:00:00.000Z',
        },
      ],
    });
    expect(skipped.map((cell) => cell.label)).toEqual([
      'REQUESTED BY',
      'NEED APPROVED',
      'PREPARED BY',
      'PROCUREMENT APPROVED',
      'FINANCE APPROVED',
      'PAID BY',
      'DELIVERY VERIFIED',
    ]);
    const withOps = memoStamps({
      originatorName: 'Musa Ibrahim',
      originatorPosition: 'General Manager',
      templateVersion: 3,
      includeOperations: true,
    });
    expect(withOps.map((cell) => cell.label)).toContain('OPERATIONS REVIEWED');
    expect(withOps).toHaveLength(8);
  });

  it('renders the vendor price comparison, recommendation and justification', () => {
    const html = renderProcurementMemoHtml({
      ...sample(3),
      quotationComparison: {
        quotations: [
          { vendorId: 'a', vendorName: 'XYZ Limited', vendorReference: 'VND-000018', amountKobo: 1_000_000, recommended: true, selected: false, documentReference: 'DOC-2026-000018' },
          { vendorId: 'b', vendorName: 'Alade & Sons', vendorReference: 'VND-000021', amountKobo: 1_200_000, recommended: false, selected: true, documentReference: 'DOC-2026-000019' },
        ],
        lowestAmountKobo: 1_000_000,
        selectedVendorId: 'b',
        selectionJustification: 'Faster delivery.',
      },
    });
    expect(html).toContain('Price comparison');
    expect(html).toContain('Best price');
    expect(html).toContain('XYZ Limited at ₦10,000.00');
    expect(html).toContain('Alade &amp; Sons at ₦12,000.00');
    expect(html).not.toContain('&amp;amp;');
    expect(html).toContain('Faster delivery.');
    expect(html).toContain('DOC-2026-000018 — quotation from XYZ Limited');
    expect(html).toContain('DOC-2026-000019 — quotation from Alade &amp; Sons');
    expect(html).toContain('requested from the selected vendor at the ED Finance stage');
  });

  it('omits the comparison for snapshots without one', () => {
    expect(renderProcurementMemoHtml(sample(3))).not.toContain('Price comparison');
  });
});
