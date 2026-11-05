import { describe, expect, it } from 'vitest';
import { eligibilityFromParts, nextStatusAfterPayment } from './payment-eligibility';

describe('payment eligibility', () => {
  it('caps after-delivery pay at accepted value and skips pay until a GRN', () => {
    const none = eligibilityFromParts({
      authorizedKobo: 400_000,
      paidKobo: 0,
      acceptedValueKobo: 0,
      anyOutstanding: true,
      timing: 'after_delivery',
      fundingRoute: 'subsidiary_operating',
      funded: false,
      closeShortApproved: false,
    });
    expect(none.payableKobo).toBe(0);
    expect(none.paymentComplete).toBe(false);
    expect(nextStatusAfterPayment(none, 'AWAITING_ED_FINANCE')).toBe('AWAITING_DELIVERY');

    const line1 = eligibilityFromParts({
      authorizedKobo: 400_000,
      paidKobo: 0,
      acceptedValueKobo: 300_000,
      anyOutstanding: true,
      timing: 'after_delivery',
      fundingRoute: 'subsidiary_operating',
      funded: false,
      closeShortApproved: false,
    });
    expect(line1.payableKobo).toBe(300_000);
    expect(nextStatusAfterPayment(line1, 'PARTIALLY_RECEIVED')).toBe('PARTIALLY_RECEIVED');
  });

  it('lets before-delivery pay the authorized remainder in slices', () => {
    const first = eligibilityFromParts({
      authorizedKobo: 400_000,
      paidKobo: 0,
      acceptedValueKobo: 0,
      anyOutstanding: true,
      timing: 'before_delivery',
      fundingRoute: 'subsidiary_operating',
      funded: false,
      closeShortApproved: false,
    });
    expect(first.payableKobo).toBe(400_000);
    expect(nextStatusAfterPayment(first, 'AWAITING_PAYMENT')).toBe('AWAITING_PAYMENT');

    const mid = eligibilityFromParts({
      authorizedKobo: 400_000,
      paidKobo: 150_000,
      acceptedValueKobo: 0,
      anyOutstanding: true,
      timing: 'before_delivery',
      fundingRoute: 'subsidiary_operating',
      funded: false,
      closeShortApproved: false,
    });
    expect(mid.payableKobo).toBe(250_000);
    expect(nextStatusAfterPayment(mid, 'AWAITING_PAYMENT')).toBe('AWAITING_PAYMENT');

    const settled = eligibilityFromParts({
      authorizedKobo: 400_000,
      paidKobo: 400_000,
      acceptedValueKobo: 0,
      anyOutstanding: true,
      timing: 'before_delivery',
      fundingRoute: 'subsidiary_operating',
      funded: false,
      closeShortApproved: false,
    });
    expect(settled.paymentComplete).toBe(true);
    expect(nextStatusAfterPayment(settled, 'AWAITING_PAYMENT')).toBe('AWAITING_DELIVERY');
  });

  it('uses accepted value as the obligation after close-short', () => {
    const closed = eligibilityFromParts({
      authorizedKobo: 400_000,
      paidKobo: 0,
      acceptedValueKobo: 300_000,
      anyOutstanding: true,
      timing: 'after_delivery',
      fundingRoute: 'subsidiary_operating',
      funded: false,
      closeShortApproved: true,
    });
    expect(closed.deliveryComplete).toBe(true);
    expect(closed.obligationKobo).toBe(300_000);
    expect(closed.payableKobo).toBe(300_000);
    expect(nextStatusAfterPayment(closed, 'PARTIALLY_RECEIVED')).toBe('AWAITING_PAYMENT');
  });
});
