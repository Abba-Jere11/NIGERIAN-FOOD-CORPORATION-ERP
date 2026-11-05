import type { ActorContext } from '@nfc/db';
import type { VendorBankDetailsView, VendorContactView, VendorView } from '@nfc/shared';
import { can } from '../auth/can';

export function stripBankDetails(view: VendorView, actor: ActorContext): VendorView {
  if (can(actor, 'vendor.view_bank_details')) return view;
  return { ...view, bank: null };
}

export function parseContacts(value: unknown): VendorContactView[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const row = entry as Record<string, unknown>;
      const name = typeof row.name === 'string' ? row.name.trim() : '';
      if (name === '') return null;
      const contactRole = row.role;
      const phone = row.phone;
      const email = row.email;
      return {
        name,
        phone: typeof phone === 'string' ? phone : null,
        email: typeof email === 'string' ? email : null,
        role: typeof contactRole === 'string' ? contactRole : null,
      };
    })
    .filter((row): row is VendorContactView => row !== null);
}

export function bankView(
  bankName: string | null,
  accountName: string | null,
  accountNumber: string | null,
): VendorBankDetailsView | null {
  if (!bankName && !accountName && !accountNumber) return null;
  return {
    bankName: bankName ?? '',
    accountName: accountName ?? '',
    accountNumber: accountNumber ?? '',
  };
}
