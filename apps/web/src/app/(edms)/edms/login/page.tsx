import { ORGANIZATION_NAME } from '@nfc/shared';
import { NfcLogo } from '@/components/brand/NfcLogo';
import { EdmsLoginForm } from './EdmsLoginForm';

export const metadata = { title: 'Document Portal — NFC' };

export default function EdmsLoginPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
      <div className="flex items-center gap-3">
        <NfcLogo size="md" priority />
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">{ORGANIZATION_NAME}</p>
          <p className="mt-1 text-[12px] text-ink-500">Document Portal</p>
        </div>
      </div>
      <div className="mt-6">
        <EdmsLoginForm />
      </div>
    </main>
  );
}
