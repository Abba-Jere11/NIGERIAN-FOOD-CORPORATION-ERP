'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { ActionResult } from './action-result';

export type AutosaveState =
  | { state: 'idle' }
  | { state: 'saving' }
  | { state: 'saved'; savedAt: Date }
  | { state: 'error'; message: string };

interface AutosaveOptions {
  formRef: RefObject<HTMLFormElement | null>;
  save: (formData: FormData) => Promise<ActionResult>;
  enabled: boolean;
  delayMs?: number;
  /** Adjusts the payload just before it is sent, e.g. to set the latest row version. */
  prepare?: (formData: FormData) => void;
  onResult?: (result: ActionResult) => void;
}

/**
 * Saves a draft in the background while the user types.
 *
 * The form is read with `new FormData(form)` and handed to the server action
 * directly. `form.requestSubmit()` is deliberately not used: it runs browser
 * validation, which cancels the save and moves focus to the first empty
 * required field, and a completed form action resets uncontrolled fields.
 * Saves run one at a time so each one carries the row version the previous
 * one returned.
 */
export function useDraftAutosave(options: AutosaveOptions) {
  const [status, setStatus] = useState<AutosaveState>({ state: 'idle' });
  const optionsRef = useRef(options);
  const timer = useRef<number | undefined>(undefined);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const queued = useRef<Promise<ActionResult | null> | null>(null);

  useLayoutEffect(() => {
    optionsRef.current = options;
  });

  const saveNow = useCallback((): Promise<ActionResult | null> => {
    window.clearTimeout(timer.current);
    if (queued.current) return queued.current;
    const run = chain.current.then(async (): Promise<ActionResult | null> => {
      queued.current = null;
      const { formRef, save, prepare, onResult } = optionsRef.current;
      const form = formRef.current;
      if (!form) return null;
      setStatus({ state: 'saving' });
      let result: ActionResult;
      try {
        const formData = new FormData(form);
        prepare?.(formData);
        result = await save(formData);
      } catch (error) {
        result = { status: 'error', message: error instanceof Error ? error.message : 'The draft was not saved.' };
      }
      onResult?.(result);
      if (result.status === 'ok') setStatus({ state: 'saved', savedAt: new Date() });
      else if (result.status === 'error') setStatus({ state: 'error', message: result.message });
      return result;
    });
    queued.current = run;
    chain.current = run.catch(() => null);
    return run;
  }, []);

  const schedule = useCallback(() => {
    if (!optionsRef.current.enabled) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      void saveNow();
    }, optionsRef.current.delayMs ?? 800);
  }, [saveNow]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return { status, schedule, saveNow };
}
