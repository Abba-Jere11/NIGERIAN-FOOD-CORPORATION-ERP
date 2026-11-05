'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { releaseHoldAction, saveCategoryAction, saveTagAction } from '../actions';

export function AdminForms({
  kind,
  modules = [],
  confidentiality = [],
  documentId,
  holdId,
}: {
  kind: 'category' | 'tag' | 'release';
  modules?: string[];
  confidentiality?: string[];
  documentId?: string;
  holdId?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  if (kind === 'tag') {
    return (
      <form
        className="space-y-2"
        action={async (formData) => {
          setError(null);
          const result = await saveTagAction(formData);
          if (result.error) setError(result.error);
        }}
      >
        {error ? <p className="text-[12px] text-danger-700">{error}</p> : null}
        <input name="key" required placeholder="Key" className="block w-full border border-ink-300 px-2 py-1.5 text-sm" />
        <input name="name" required placeholder="Name" className="block w-full border border-ink-300 px-2 py-1.5 text-sm" />
        <Button type="submit" size="sm">
          Add tag
        </Button>
      </form>
    );
  }
  if (kind === 'release' && documentId && holdId) {
    return (
      <form
        className="flex flex-wrap items-end gap-2"
        action={async (formData) => {
          setError(null);
          const result = await releaseHoldAction(documentId, holdId, formData);
          if (result.error) setError(result.error);
        }}
      >
        {error ? <p className="text-[12px] text-danger-700">{error}</p> : null}
        <input
          name="reason"
          required
          placeholder="Release reason"
          className="border border-ink-300 px-2 py-1.5 text-sm"
        />
        <Button type="submit" size="sm">
          Release
        </Button>
      </form>
    );
  }
  return (
    <form
      className="space-y-2"
      action={async (formData) => {
        setError(null);
        const result = await saveCategoryAction(formData);
        if (result.error) setError(result.error);
      }}
    >
      {error ? <p className="text-[12px] text-danger-700">{error}</p> : null}
      <input name="key" required placeholder="Key" className="block w-full border border-ink-300 px-2 py-1.5 text-sm" />
      <input name="name" required placeholder="Name" className="block w-full border border-ink-300 px-2 py-1.5 text-sm" />
      <select name="module" className="block w-full border border-ink-300 px-2 py-1.5 text-sm">
        {modules.map((module) => (
          <option key={module} value={module}>
            {module}
          </option>
        ))}
      </select>
      <input
        name="retainYears"
        type="number"
        min={1}
        defaultValue={7}
        className="block w-full border border-ink-300 px-2 py-1.5 text-sm"
      />
      <select name="confidentiality" className="block w-full border border-ink-300 px-2 py-1.5 text-sm">
        {confidentiality.map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" name="requiresApproval" /> Requires approval
      </label>
      <Button type="submit" size="sm">
        Add category
      </Button>
    </form>
  );
}
