'use client';

import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  amountInWords,
  formatNairaInputFromKobo,
  formatNairaTyping,
  MoneyError,
  parseNairaToKobo,
} from '@nfc/shared';
import { cx } from '@/lib/cx';
import { CONTROL_CLASS } from './Field';

function parseOrNull(text: string): bigint | null {
  if (text.trim() === '') return null;
  try {
    return parseNairaToKobo(text);
  } catch {
    return null;
  }
}

/**
 * Kobo-safe money input (A7).
 *
 * The visible field holds the text the user typed, grouped with commas as they
 * type. Digits are whole Naira; a kobo remainder appears only after a decimal
 * point. What is submitted is a hidden field containing an exact integer number
 * of kobo, parsed by string arithmetic.
 *
 * `onKoboChange` fires from the change handler, never from an effect, so a
 * parent may pass an inline callback that sets state.
 */
export function MoneyInput({
  name,
  label,
  defaultKobo,
  required,
  errors,
  hint,
  disabled,
  compact,
  hideWords,
  onKoboChange,
}: {
  name: string;
  label: string;
  defaultKobo?: string;
  required?: boolean;
  errors?: string[];
  hint?: string;
  disabled?: boolean;
  compact?: boolean;
  hideWords?: boolean;
  onKoboChange?: (kobo: bigint | null) => void;
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const [text, setText] = useState(() => (defaultKobo ? formatNairaInputFromKobo(BigInt(defaultKobo)) : ''));

  const parsed = useMemo(() => {
    if (text.trim() === '') return { kobo: null, error: null, words: null };
    try {
      const kobo = parseNairaToKobo(text);
      return { kobo, error: null, words: amountInWords(kobo) };
    } catch (error) {
      return {
        kobo: null,
        error: error instanceof MoneyError ? error.message : 'That is not a valid amount.',
        words: null,
      };
    }
  }, [text]);

  useLayoutEffect(() => {
    const input = inputRef.current;
    const caret = pendingCaret.current;
    if (input && caret !== null && document.activeElement === input) {
      input.setSelectionRange(caret, caret);
    }
    pendingCaret.current = null;
  }, [text]);

  const shownErrors = [...(errors ?? []), ...(parsed.error ? [parsed.error] : [])];
  const invalid = shownErrors.length > 0;

  return (
    <div className={cx(compact ? 'min-w-0' : 'space-y-1')}>
      <label
        htmlFor={id}
        className={cx(
          compact
            ? 'sr-only'
            : 'block text-[12px] font-semibold text-ink-700',
        )}
      >
        {label}
        {required && !compact ? (
          <span className="ml-0.5 text-danger-600" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>

      <div className="flex items-stretch">
        {compact ? null : (
          <span
            aria-hidden="true"
            className="flex items-center border border-r-0 border-ink-300 bg-surface-muted px-2 text-sm text-ink-500"
          >
            &#8358;
          </span>
        )}
        <input
          ref={inputRef}
          id={id}
          inputMode="decimal"
          autoComplete="off"
          disabled={disabled}
          required={required}
          aria-invalid={invalid}
          aria-describedby={invalid ? `${id}-error` : hideWords || compact ? undefined : `${id}-words`}
          placeholder="0"
          value={text}
          onChange={(event) => {
            const input = event.target;
            const formatted = formatNairaTyping(input.value, input.selectionStart ?? input.value.length);
            pendingCaret.current = formatted.caret;
            setText(formatted.text);
            onKoboChange?.(parseOrNull(formatted.text));
          }}
          className={cx(CONTROL_CLASS, 'tabular text-right', compact && 'py-1 text-[13px]')}
        />
      </div>

      <input type="hidden" name={name} value={parsed.kobo === null ? '' : parsed.kobo.toString()} />

      {invalid ? (
        <ul id={`${id}-error`} className="space-y-0.5">
          {shownErrors.map((error) => (
            <li key={error} className="text-[12px] text-danger-700">
              {error}
            </li>
          ))}
        </ul>
      ) : hideWords || compact ? null : (
        <p id={`${id}-words`} className="min-h-[18px] text-[12px] text-ink-500">
          {parsed.words ?? hint ?? ''}
        </p>
      )}
    </div>
  );
}
