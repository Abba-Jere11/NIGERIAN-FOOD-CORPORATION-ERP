'use client';

import { useTransition } from 'react';
import type { NotificationPreferenceView } from '@nfc/shared';
import { Button } from '@/components/ui/Button';
import { setNotificationPreference } from './actions';

export function PreferenceForm({ preferences }: { preferences: NotificationPreferenceView[] }) {
  const [pending, start] = useTransition();

  return (
    <ul className="divide-y divide-ink-100 text-[13px]">
      {preferences.map((row) => (
        <li key={row.category} className="flex items-center justify-between gap-3 px-4 py-2">
          <div>
            <p className="font-medium capitalize text-ink-900">{row.category.replace('_', ' ')}</p>
            {row.mandatory ? (
              <p className="text-[12px] text-ink-500">Required. Email cannot be turned off.</p>
            ) : (
              <p className="text-[12px] text-ink-500">Optional email copy of in-app notices.</p>
            )}
          </div>
          <Button
            type="button"
            size="sm"
            variant="subtle"
            disabled={pending || row.mandatory}
            onClick={() =>
              start(() => setNotificationPreference(row.category, !row.emailEnabled))
            }
          >
            {row.emailEnabled ? 'Email on' : 'Email off'}
          </Button>
        </li>
      ))}
    </ul>
  );
}
