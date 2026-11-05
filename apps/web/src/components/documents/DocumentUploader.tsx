'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';

export function DocumentUploader({
  action,
}: {
  action: (formData: FormData) => Promise<{ error?: string }>;
}) {
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="space-y-3"
      action={async (formData) => {
        setError(null);
        setProgress('Uploading…');
        const result = await action(formData);
        if (result.error) {
          setError(result.error);
          setProgress(null);
          return;
        }
        setProgress('Stored.');
      }}
    >
      <label className="block text-[12px] font-semibold text-ink-700">
        Title
        <input
          name="title"
          required
          className="mt-1 block w-full border border-ink-300 px-2 py-1.5 text-sm"
        />
      </label>
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
      <input type="hidden" name="category" value="general" />
      <input type="hidden" name="context" value="general" />
      <Button type="submit" variant="primary">
        Upload
      </Button>
      {progress ? <p className="text-[12px] text-ink-500">{progress}</p> : null}
      {error ? <p className="text-[12px] text-danger-700">{error}</p> : null}
    </form>
  );
}
