'use client';

import type { VendorView } from '@nfc/shared';
import { ActionDialog } from '@/components/ui/Dialog';
import { TextField } from '@/components/ui/Field';
import { changeBankAction, submitVendorAction, vendorStatusAction } from './actions';

export function VendorActions({
  vendor,
  canCreate,
  canActivate,
  canSuspend,
  canBlacklist,
}: {
  vendor: VendorView;
  canCreate: boolean;
  canActivate: boolean;
  canSuspend: boolean;
  canBlacklist: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {canCreate && vendor.status === 'DRAFT' ? (
        <ActionDialog
          triggerLabel="Submit for onboarding"
          triggerVariant="primary"
          title="Submit for onboarding"
          description="A different user with activation permission must approve."
          submitLabel="Submit"
          successMessage="Submitted."
          action={submitVendorAction}
          hiddenFields={{ id: vendor.id }}
        />
      ) : null}
      {canCreate && vendor.status === 'ACTIVE' ? (
        <ActionDialog
          triggerLabel="Change bank details"
          title="Change bank details"
          description="The vendor becomes Pending re-verification until a different user approves."
          submitLabel="Submit bank details"
          successMessage="Submitted for re-verification."
          action={changeBankAction}
          hiddenFields={{ id: vendor.id, rowVersion: String(vendor.rowVersion) }}
        >
          {() => (
            <>
              <TextField label="Bank name" name="bankName" required defaultValue={vendor.bank?.bankName} />
              <TextField label="Account name" name="accountName" required defaultValue={vendor.bank?.accountName} />
              <TextField
                label="Account number"
                name="accountNumber"
                required
                defaultValue={vendor.bank?.accountNumber}
              />
            </>
          )}
        </ActionDialog>
      ) : null}
      {canActivate && vendor.status === 'PENDING_REVERIFICATION' ? (
        <ActionDialog
          triggerLabel="Approve bank details"
          triggerVariant="primary"
          title="Approve bank details"
          submitLabel="Approve"
          successMessage="Vendor is Active."
          action={vendorStatusAction}
          hiddenFields={{
            id: vendor.id,
            action: 'approve-bank',
            rowVersion: String(vendor.rowVersion),
          }}
        />
      ) : null}
      {canSuspend && (vendor.status === 'ACTIVE' || vendor.status === 'PENDING_REVERIFICATION') ? (
        <ActionDialog
          triggerLabel="Suspend"
          triggerVariant="danger"
          title="Suspend vendor"
          submitLabel="Suspend"
          submitVariant="danger"
          successMessage="Suspended."
          action={vendorStatusAction}
          requireReason
          hiddenFields={{
            id: vendor.id,
            action: 'suspend',
            rowVersion: String(vendor.rowVersion),
          }}
        />
      ) : null}
      {canBlacklist && vendor.status !== 'BLACKLISTED' && vendor.status !== 'DRAFT' ? (
        <ActionDialog
          triggerLabel="Blacklist"
          triggerVariant="danger"
          title="Blacklist vendor"
          submitLabel="Blacklist"
          submitVariant="danger"
          successMessage="Blacklisted."
          action={vendorStatusAction}
          requireReason
          hiddenFields={{
            id: vendor.id,
            action: 'blacklist',
            rowVersion: String(vendor.rowVersion),
          }}
        />
      ) : null}
      {canActivate && vendor.status === 'SUSPENDED' ? (
        <ActionDialog
          triggerLabel="Reactivate"
          triggerVariant="primary"
          title="Reactivate vendor"
          submitLabel="Reactivate"
          successMessage="Active."
          action={vendorStatusAction}
          requireReason
          hiddenFields={{
            id: vendor.id,
            action: 'reactivate',
            rowVersion: String(vendor.rowVersion),
          }}
        />
      ) : null}
    </div>
  );
}
