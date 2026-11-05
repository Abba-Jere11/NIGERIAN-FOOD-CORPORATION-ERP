'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { replaceDocumentAction } from '../actions';

export function ReplaceForm({ documentId }: { documentId: string }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="space-y-2"
      action={async (formData) => {
        setError(null);
        const result = await replaceDocumentAction(documentId, formData);
        if (result.error) setError(result.error);
      }}
    >
      <label className="block text-[12px] font-semibold text-ink-700">
        Replacement reason
        <textarea
          name="reason"
          required
          minLength={5}
          rows={2}
          className="mt-1 block w-full border border-ink-300 px-2 py-1.5 text-sm"
        />
      </label>
      <input name="file" type="file" required accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" />
      <input type="hidden" name="context" value="general" />
      <Button type="submit" variant="secondary" size="sm">
        Replace
      </Button>
      {error ? <p className="text-[12px] text-danger-700">{error}</p> : null}
    </form>
  );
}
