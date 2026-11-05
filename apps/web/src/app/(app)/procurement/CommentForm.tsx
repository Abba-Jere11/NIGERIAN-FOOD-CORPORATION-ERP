'use client';

import { useRef } from 'react';
import { useToastAction } from '@/lib/use-toast-action';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/States';
import { addCommentAction } from './actions';

export function CommentForm({ requestId }: { requestId: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useToastAction(addCommentAction, {
    errorTitle: 'Comment was not saved',
    onSuccess: () => formRef.current?.reset(),
  });
  return (
    <form ref={formRef} action={formAction} className="space-y-2">
      <input type="hidden" name="id" value={requestId} />
      {state.status === 'error' ? (
        <ErrorState title="Comment was not saved" message={state.message} requestId={state.requestId} />
      ) : null}
      <textarea name="body" required className="w-full border border-ink-300 px-2 py-1 text-[13px]" rows={3} />
      <Button type="submit" variant="secondary" size="sm" disabled={pending}>
        {pending ? 'Adding…' : 'Add comment'}
      </Button>
    </form>
  );
}
