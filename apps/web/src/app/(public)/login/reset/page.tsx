import { Suspense } from 'react';
import ResetForm from './ResetForm';

export default function ResetPage() {
  return (
    <Suspense fallback={<p className="text-[13px] text-ink-500">Loading…</p>}>
      <ResetForm />
    </Suspense>
  );
}
