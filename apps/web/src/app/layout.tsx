import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import type { DevActorSummaryView, MeView } from '@nfc/shared';
import { ORGANIZATION_NAME } from '@nfc/shared';
import { AppShell } from '@/components/shell/AppShell';
import { ToastProvider } from '@/components/ui/Toast';
import { getSelectedActorKey } from '@/lib/actor';
import { apiFetch, ApiError } from '@/lib/api';
import './globals.css';

export const metadata: Metadata = {
  title: `${ORGANIZATION_NAME} — Internal Management System`,
  description: 'Internal corporate system for Nigeria Food Corporation and its four subsidiaries.',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const selectedActorKey = await getSelectedActorKey();

  let me: MeView | null = null;
  let actors: DevActorSummaryView[] = [];
  let setupProblem: string | null = null;

  try {
    [me, actors] = await Promise.all([
      apiFetch<MeView>('/api/me'),
      apiFetch<DevActorSummaryView[]>('/api/dev-actors'),
    ]);
  } catch (error) {
    setupProblem =
      error instanceof ApiError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);
  }

  return (
    <html lang="en-NG">
      <body>
        <ToastProvider>
          {me ? (
            <AppShell me={me} actors={actors} selectedActorKey={selectedActorKey}>
              {children}
            </AppShell>
          ) : (
            <SetupRequired problem={setupProblem ?? 'The API could not be reached.'} />
          )}
        </ToastProvider>
      </body>
    </html>
  );
}

/**
 * Shown when the API or database is not ready. It states what to run rather than
 * failing with a stack trace, because the first thing anyone does with a fresh
 * checkout is start it before the database exists.
 */
function SetupRequired({ problem }: { problem: string }) {
  const steps = [
    'Copy .env.example to .env and set PGPASSWORD to the password for your local postgres role.',
    'pnpm db:bootstrap — creates the nfc_app role and both databases.',
    'pnpm db:migrate — applies the SQL migrations.',
    'pnpm db:seed — seeds NFC Holding and the four subsidiaries.',
    'pnpm dev — starts the API on port 4000 and this application on port 3000.',
  ];

  return (
    <main className="mx-auto max-w-2xl px-4 py-16">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">
        {ORGANIZATION_NAME}
      </p>
      <h1 className="mt-1 text-xl font-semibold text-ink-900">This system is not ready yet</h1>

      <div className="mt-4 border-l-2 border-danger-600 bg-danger-100 px-3 py-2">
        <p className="text-[13px] text-ink-900">{problem}</p>
      </div>

      <h2 className="mt-6 text-[13px] font-semibold text-ink-900">To get it running</h2>
      <ol className="mt-2 space-y-2">
        {steps.map((step, index) => (
          <li key={step} className="flex gap-2 text-[13px] text-ink-700">
            <span className="tabular shrink-0 text-ink-400">{index + 1}.</span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
    </main>
  );
}
