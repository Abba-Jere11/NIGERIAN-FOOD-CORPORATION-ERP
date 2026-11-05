'use client';

import { useState } from 'react';
import type { EdmsDocumentView, EdmsGatewayEntityView, RoleKey } from '@nfc/shared';
import { ROLE_KEYS } from '@nfc/shared';
import { Button } from '@/components/ui/Button';
import {
  archiveEdmsAction,
  holdEdmsAction,
  refileEdmsAction,
  replaceEdmsAction,
  revokeShareAction,
  shareEdmsAction,
} from './actions';

const ROLE_LABEL: Record<RoleKey, string> = {
  gm: 'General Manager',
  ed_operations: 'ED Operations',
  md: 'Managing Director',
  ed_finance: 'ED Finance',
  finance_head: 'Finance Head',
  administrator: 'Administrator',
  inventory_officer: 'Procurement Manager',
  hr_officer: 'HR Officer',
  staff: 'Staff',
};

export function DocumentActions({
  document,
  canReplace,
  canArchive,
  canShare,
  canHold,
  canRefile,
  entities,
  users,
}: {
  document: EdmsDocumentView;
  canReplace: boolean;
  canArchive: boolean;
  canShare: boolean;
  canHold: boolean;
  canRefile: boolean;
  entities: EdmsGatewayEntityView[];
  users: Array<{ id: string; name: string; email: string }>;
}) {
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      {error ? (
        <p role="alert" className="border-l-2 border-danger-600 bg-danger-100 px-3 py-2 text-[13px] text-danger-800">
          {error}
        </p>
      ) : null}
      {canReplace ? (
        <form
          className="space-y-2"
          action={async (formData) => {
            setError(null);
            const result = await replaceEdmsAction(document.id, formData);
            if (result.error) setError(result.error);
          }}
        >
          <h3 className="text-[13px] font-semibold text-ink-900">Replace version</h3>
          <textarea
            name="reason"
            required
            minLength={3}
            rows={2}
            placeholder="Reason"
            className="block w-full border border-ink-300 px-2 py-1.5 text-sm"
          />
          <input name="file" type="file" required accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" />
          <Button type="submit" size="sm">
            Replace
          </Button>
        </form>
      ) : null}
      {canShare ? (
        <form
          className="space-y-2"
          action={async (formData) => {
            setError(null);
            const result = await shareEdmsAction(document.id, formData);
            if (result.error) setError(result.error);
          }}
        >
          <h3 className="text-[13px] font-semibold text-ink-900">Share</h3>
          <select name="granteeUserId" className="block w-full border border-ink-300 px-2 py-1.5 text-sm">
            <option value="">Named user…</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name} ({user.email})
              </option>
            ))}
          </select>
          <select name="granteeRole" className="block w-full border border-ink-300 px-2 py-1.5 text-sm">
            <option value="">Or a role…</option>
            {ROLE_KEYS.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABEL[role]}
              </option>
            ))}
          </select>
          <input name="expiresAt" type="datetime-local" className="block border border-ink-300 px-2 py-1.5 text-sm" />
          <Button type="submit" size="sm">
            Share
          </Button>
        </form>
      ) : null}
      {document.shares.filter((share) => !share.revokedAt).length > 0 ? (
        <ul className="space-y-1 text-[13px]">
          {document.shares
            .filter((share) => !share.revokedAt)
            .map((share) => (
              <li key={share.id} className="flex items-center justify-between gap-2">
                <span>
                  {share.granteeName}
                  {share.expiresAt ? ` · expires ${share.expiresAt}` : ''}
                </span>
                {canShare ? (
                  <form
                    action={async () => {
                      setError(null);
                      const result = await revokeShareAction(document.id, share.id);
                      if (result.error) setError(result.error);
                    }}
                  >
                    <Button type="submit" size="sm" variant="subtle">
                      Revoke
                    </Button>
                  </form>
                ) : null}
              </li>
            ))}
        </ul>
      ) : null}
      {canArchive ? (
        <form
          className="space-y-2"
          action={async (formData) => {
            setError(null);
            const result = await archiveEdmsAction(document.id, formData);
            if (result.error) setError(result.error);
          }}
        >
          <h3 className="text-[13px] font-semibold text-ink-900">Archive</h3>
          <textarea
            name="reason"
            required
            minLength={3}
            rows={2}
            className="block w-full border border-ink-300 px-2 py-1.5 text-sm"
          />
          <Button type="submit" size="sm" variant="danger">
            Archive
          </Button>
        </form>
      ) : null}
      {canHold ? (
        <form
          className="space-y-2"
          action={async (formData) => {
            setError(null);
            const result = await holdEdmsAction(document.id, formData);
            if (result.error) setError(result.error);
          }}
        >
          <h3 className="text-[13px] font-semibold text-ink-900">Legal hold</h3>
          <textarea
            name="reason"
            required
            minLength={3}
            rows={2}
            className="block w-full border border-ink-300 px-2 py-1.5 text-sm"
          />
          <Button type="submit" size="sm">
            Place hold
          </Button>
        </form>
      ) : null}
      {canRefile ? (
        <form
          className="space-y-2"
          action={async (formData) => {
            setError(null);
            const result = await refileEdmsAction(document.id, formData);
            if (result.error) setError(result.error);
          }}
        >
          <h3 className="text-[13px] font-semibold text-ink-900">Re-file</h3>
          <select name="destEntityId" required className="block w-full border border-ink-300 px-2 py-1.5 text-sm">
            {entities
              .filter((entity) => entity.id !== document.entityId)
              .map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.code} — {entity.name}
                </option>
              ))}
          </select>
          <textarea
            name="reason"
            required
            minLength={3}
            rows={2}
            className="block w-full border border-ink-300 px-2 py-1.5 text-sm"
          />
          <Button type="submit" size="sm">
            Re-file
          </Button>
        </form>
      ) : null}
    </div>
  );
}
