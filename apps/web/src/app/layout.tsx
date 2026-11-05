import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ORGANIZATION_NAME } from '@nfc/shared';
import { ToastProvider } from '@/components/ui/Toast';
import './globals.css';

export const metadata: Metadata = {
  title: `${ORGANIZATION_NAME} — Internal Management System`,
  description: 'Internal corporate system for Nigeria Food Corporation and its four subsidiaries.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-NG">
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
