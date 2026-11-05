'use client';

import { Suspense, useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';
import { isNoticeKey, NOTICES } from '@/lib/notices';

function NoticeToastInner() {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const { toast } = useToast();
  const notice = params.get('notice');

  useEffect(() => {
    if (!isNoticeKey(notice)) return;
    toast(NOTICES[notice], 'success');
    const next = new URLSearchParams(params.toString());
    next.delete('notice');
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [notice, params, pathname, router, toast]);

  return null;
}

/** Shows the toast for a `?notice=` left by a redirecting server action. */
export function NoticeToast() {
  return (
    <Suspense fallback={null}>
      <NoticeToastInner />
    </Suspense>
  );
}
