'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { revokeSessionAction } from './actions';

export function RevokeSessionButton({ id }: { id: string }) {
  const router = useRouter();
  return (
    <Button
      size="sm"
      onClick={async () => {
        await revokeSessionAction(id);
        router.refresh();
      }}
    >
      Revoke
    </Button>
  );
}
