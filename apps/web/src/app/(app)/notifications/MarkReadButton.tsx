'use client';

import { useTransition } from 'react';
import { Button } from '@/components/ui/Button';
import { markNotificationRead } from './actions';

export function MarkReadButton({ id, read }: { id: string; read: boolean }) {
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      size="sm"
      variant="subtle"
      disabled={pending}
      onClick={() => start(() => markNotificationRead(id, !read))}
    >
      {read ? 'Mark unread' : 'Mark read'}
    </Button>
  );
}
