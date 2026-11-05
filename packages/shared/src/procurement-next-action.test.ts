import { describe, expect, it } from 'vitest';
import { canTakeProcurementAction, procurementNextAction } from './procurement';

const base = {
  requisitionId: 'req-1',
  returned: false,
  finalPaymentTiming: 'before_delivery' as const,
  fundingRoute: 'subsidiary_operating' as const,
  invoiceStage: 'ready',
  deliveryComplete: false,
  paymentComplete: false,
};

describe('procurementNextAction', () => {
  it('asks the Procurement Manager for the invoice before ED Finance can fund', () => {
    expect(
      procurementNextAction({
        ...base,
        status: 'AWAITING_ED_FINANCE',
        invoiceStage: 'awaiting_invoice',
      }),
    ).toMatchObject({
      key: 'upload_invoice',
      responsible: 'Procurement Manager',
      anchor: 'invoice',
    });
  });

  it('asks MD to decide a pending invoice variance', () => {
    expect(
      procurementNextAction({
        ...base,
        status: 'AWAITING_ED_FINANCE',
        invoiceStage: 'variance_pending',
      })?.key,
    ).toBe('decide_invoice_variance');
  });

  it('asks ED Finance to approve funding once the invoice matches', () => {
    expect(
      procurementNextAction({
        ...base,
        status: 'AWAITING_ED_FINANCE',
        invoiceStage: 'ready',
      }),
    ).toMatchObject({
      key: 'approve_funding',
      responsible: 'ED Finance',
      anchor: 'finance',
    });
  });

  it('orders pay-then-deliver as payment then delivery verification', () => {
    expect(
      procurementNextAction({
        ...base,
        status: 'AWAITING_PAYMENT',
        finalPaymentTiming: 'before_delivery',
      }),
    ).toMatchObject({
      key: 'pay_vendor',
      label: 'Pay the vendor',
      responsible: 'Finance Head',
    });
    expect(
      procurementNextAction({
        ...base,
        status: 'AWAITING_DELIVERY',
        finalPaymentTiming: 'before_delivery',
        paymentComplete: true,
      }),
    ).toMatchObject({
      key: 'verify_delivery',
      label: 'Verify the delivery of each item',
      responsible: 'Procurement Manager',
      anchor: 'delivery',
    });
  });

  it('orders deliver-then-pay as verification then payment', () => {
    expect(
      procurementNextAction({
        ...base,
        status: 'AWAITING_DELIVERY',
        finalPaymentTiming: 'after_delivery',
        paymentComplete: false,
      })?.key,
    ).toBe('verify_delivery');
    expect(
      procurementNextAction({
        ...base,
        status: 'AWAITING_PAYMENT',
        finalPaymentTiming: 'after_delivery',
        deliveryComplete: true,
      }),
    ).toMatchObject({
      key: 'pay_vendor',
      label: 'Pay the vendor for the verified delivery',
    });
  });

  it('routes corporate payment to ED Finance', () => {
    expect(
      procurementNextAction({
        ...base,
        status: 'AWAITING_PAYMENT',
        fundingRoute: 'nfc_holding',
      }),
    ).toMatchObject({
      permission: 'finance.payment.execute.corporate',
      responsible: 'ED Finance',
      scope: 'CORPORATE',
    });
  });

  it('asks for a funding transfer on route C', () => {
    expect(
      procurementNextAction({
        ...base,
        status: 'FUNDING_PENDING',
        fundingRoute: 'corporate_allocation',
      })?.key,
    ).toBe('record_transfer');
  });

  it('asks for outstanding items when partially received', () => {
    expect(
      procurementNextAction({
        ...base,
        status: 'PARTIALLY_RECEIVED',
        paymentComplete: true,
      })?.label,
    ).toBe('Verify the outstanding items when they arrive');
  });
});

describe('canTakeProcurementAction', () => {
  const action = procurementNextAction({
    ...base,
    status: 'AWAITING_ED_FINANCE',
    invoiceStage: 'awaiting_invoice',
  })!;

  it('limits preparer-scoped actions to the preparer when one is set', () => {
    const person = {
      ref: 'officer-1',
      permissions: ['procurement.prepare'],
      isCorporate: false,
      entityIds: ['yfz'],
    };
    expect(
      canTakeProcurementAction(action, person, {
        entityId: 'yfz',
        preparedByUserId: 'officer-1',
      }),
    ).toBe(true);
    expect(
      canTakeProcurementAction(action, person, {
        entityId: 'yfz',
        preparedByUserId: 'other',
      }),
    ).toBe(false);
  });

  it('keeps Finance Head payment on the same entity', () => {
    const pay = procurementNextAction({
      ...base,
      status: 'AWAITING_PAYMENT',
    })!;
    expect(
      canTakeProcurementAction(
        pay,
        {
          ref: 'fh',
          permissions: ['finance.payment.execute'],
          isCorporate: false,
          entityIds: ['yfz'],
        },
        { entityId: 'yfz', preparedByUserId: null },
      ),
    ).toBe(true);
    expect(
      canTakeProcurementAction(
        pay,
        {
          ref: 'fh',
          permissions: ['finance.payment.execute'],
          isCorporate: false,
          entityIds: ['dma'],
        },
        { entityId: 'yfz', preparedByUserId: null },
      ),
    ).toBe(false);
  });
});
