'use client';

import { useState } from 'react';
import { REQUIRED_VENDOR_COMPLIANCE } from '@nfc/shared';
import { Button } from '@/components/ui/Button';
import { DateField, SelectField, TextField } from '@/components/ui/Field';
import { uploadComplianceAction } from './actions';

export function ComplianceUploadForm({ vendorId }: { vendorId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  return (
    <form
      className="space-y-3"
      action={async (formData) => {
        setError(null);
        setProgress('Uploading…');
        const result = await uploadComplianceAction(formData);
        if (result.error) {
          setError(result.error);
          setProgress(null);
          return;
        }
        setProgress('Stored.');
      }}
    >
      <input type="hidden" name="vendorId" value={vendorId} />
      <SelectField
        label="Type"
        name="complianceType"
        required
        options={REQUIRED_VENDOR_COMPLIANCE.map((type) => ({
          value: type,
          label: type.replaceAll('_', ' '),
        })).concat([{ value: 'OTHER', label: 'Other' }])}
      />
      <DateField label="Expires" name="expiresAt" />
      <TextField label="Title" name="title" />
      <label className="block text-[12px] font-semibold text-ink-700">
        File
        <input
          name="file"
          type="file"
          required
          accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
          className="mt-1 block w-full text-sm"
        />
      </label>
      <Button type="submit" variant="primary">
        Attach
      </Button>
      {progress ? <p className="text-[12px] text-ink-500">{progress}</p> : null}
      {error ? <p className="text-[12px] text-danger-700">{error}</p> : null}
    </form>
  );
}
