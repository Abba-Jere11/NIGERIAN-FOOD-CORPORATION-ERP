'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { cx } from '@/lib/cx';

/**
 * Toast messages (M1 item 6). Short confirmations only: anything a user must be
 * able to re-read later belongs in the record and its audit trail, not here.
 */
export type ToastTone = 'success' | 'error' | 'info';

interface ToastMessage {
  id: number;
  tone: ToastTone;
  text: string;
}

interface ToastContextValue {
  toast: (text: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TONES: Record<ToastTone, string> = {
  success: 'border-accent-700 bg-accent-50 text-accent-900',
  error: 'border-danger-600 bg-danger-100 text-danger-700',
  info: 'border-ink-300 bg-surface text-ink-900',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<ToastMessage[]>([]);

  const toast = useCallback((text: string, tone: ToastTone = 'success') => {
    const id = Date.now() + Math.random();
    setMessages((current) => [...current, { id, tone, text }]);
    setTimeout(() => {
      setMessages((current) => current.filter((message) => message.id !== id));
    }, 6000);
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="no-print pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2"
      >
        {messages.map((message) => (
          <div
            key={message.id}
            role="status"
            className={cx(
              'pointer-events-auto border-l-2 px-3 py-2 text-[13px] shadow-sm',
              TONES[message.tone],
            )}
          >
            {message.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used inside a ToastProvider.');
  }
  return context;
}
