'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { EdmsCategoryView, EdmsGatewayEntityView, EdmsTagView } from '@nfc/shared';
import { Button } from '@/components/ui/Button';
import { SelectField, TextField } from '@/components/ui/Field';
import { Surface } from '@/components/ui/Surface';
import { uploadEdmsAction } from '../actions';

export function UploadForm({
  entities,
  folders,
  categories,
  tags,
  entityId,
  folderId,
}: {
  entities: EdmsGatewayEntityView[];
  folders: Array<{ id: string; label: string }>;
  categories: EdmsCategoryView[];
  tags: EdmsTagView[];
  entityId: string;
  folderId: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState(folderId);
  const locked = entities.length === 1;
  const entity = entities.find((item) => item.id === entityId);
  const folderLabel = useMemo(
    () => folders.find((folder) => folder.id === selectedFolderId)?.label ?? 'Select a folder',
    [folders, selectedFolderId],
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_16rem]">
      <form
        className="max-w-lg space-y-3"
        action={async (formData) => {
          setError(null);
          const result = await uploadEdmsAction(formData);
          if (result?.error) setError(result.error);
        }}
      >
        {error ? (
          <p
            role="alert"
            className="border-l-2 border-danger-600 bg-danger-100 px-3 py-2 text-[13px] text-danger-800"
          >
            {error}
          </p>
        ) : null}
        <SelectField
          label="Entity"
          name="entityId"
          required
          disabled={locked}
          value={entityId}
          onChange={(event) => router.push(`/edms/upload?entityId=${event.target.value}`)}
          options={entities.map((item) => ({
            value: item.id,
            label: `${item.code} — ${item.name}`,
          }))}
        />
        {locked ? <input type="hidden" name="entityId" value={entityId} /> : null}
        <SelectField
          label="Destination folder"
          name="folderId"
          required
          value={selectedFolderId}
          onChange={(event) => setSelectedFolderId(event.target.value)}
          options={folders.map((folder) => ({ value: folder.id, label: folder.label }))}
        />
        <SelectField
          label="Category"
          name="categoryId"
          required
          options={categories.map((category) => ({ value: category.id, label: category.name }))}
        />
        <TextField name="title" label="Document title" required />
        {tags.length > 0 ? (
          <label className="block text-[12px] font-semibold text-ink-700">
            Tags
            <select
              name="tags"
              multiple
              className="mt-1 block h-24 w-full border border-ink-300 bg-surface px-2 py-1.5 text-sm"
            >
              {tags.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="block text-[12px] font-semibold text-ink-700">
          File
          <input
            name="file"
            type="file"
            required
            accept=".pdf,.jpg,.jpeg,.png,.docx,application/pdf,image/jpeg,image/png,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="mt-1 block w-full border border-dashed border-ink-300 bg-ink-50 px-3 py-4 text-sm"
          />
          <span className="mt-1 block text-[11px] font-normal text-ink-500">
            PDF, JPEG, PNG or DOCX. Maximum 25 MB.
          </span>
        </label>
        <Button type="submit" variant="primary">
          Upload document
        </Button>
      </form>
      <Surface className="h-fit">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">Destination</p>
        <p className="mt-2 text-[14px] font-semibold text-ink-900">
          {entity ? `${entity.code} — ${entity.name}` : 'Entity'}
        </p>
        <p className="mt-1 text-[13px] text-ink-600">{folderLabel}</p>
      </Surface>
    </div>
  );
}
