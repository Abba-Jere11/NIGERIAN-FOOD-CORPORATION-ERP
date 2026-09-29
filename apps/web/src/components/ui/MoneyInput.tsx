'use client';

import { useId, useMemo, useState } from 'react';
import { amountInWords, formatKobo, MoneyError, parseNairaToKobo } from '@nfc/shared';
import { cx } from '@/lib/cx';
import { CONTROL_CLASS } from './Field';

/**
 * Kobo-safe money input (A7).
 *
 * The visible field holds the text the user typed. What is submitted is a hidden
 * field containing an exact integer number of kobo, parsed by string arithmetic.
 * No floating point is involved at any point, so ₦12,500.50 submits as 1250050
 * and never as 1250049.999999.
 *
 * The amount in words is shown live, because that is what a memo or payment
 * document must carry and the person entering it should see it before approving.
 */
export function MoneyInput({
  name,
  label,
  defaultKobo,
  required,
  errors,
  hint,
  disabled,
}: {
  name: string;
  label: string;
  defaultKobo?: string;
  required?: boolean;
  errors?: string[];
  hint?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const initialText = defaultKobo ? formatPlainFromKobo(defaultKobo) : '';
  const [text, setText] = useState(initialText);

  const parsed = useMemo(() => {
    if (text.trim() === '') return { kobo: null, error: null, words: null };
    try {
      const kobo = parseNairaToKobo(text);
      return { kobo, error: null, words: amountInWords(kobo), display: formatKobo(kobo) };
    } catch (error) {
      return {
        kobo: null,
        error: error instanceof MoneyError ? error.message : 'That is not a valid amount.',
        words: null,
      };
    }
  }, [text]);

  const shownErrors = [...(errors ?? []), ...(parsed.error ? [parsed.error] : [])];
  const invalid = shownErrors.length > 0;

  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-[12px] font-semibold text-ink-700">
        {label}
        {required ? (
          <span className="ml-0.5 text-danger-600" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>

      <div className="flex items-stretch">
        <span
          aria-hidden="true"
          className="flex items-center border border-r-0 border-ink-300 bg-surface-muted px-2 text-sm text-ink-500"
        >
          &#8358;
        </span>
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          disabled={disabled}
          required={required}
          aria-invalid={invalid}
          aria-describedby={invalid ? `${id}-error` : `${id}-words`}
          placeholder="0.00"
          value={text}
          onChange={(event) => setText(event.target.value)}
          className={cx(CONTROL_CLASS, 'tabular text-right')}
        />
      </div>

      {/* The exact integer kobo value is what the server receives. */}
      <input type="hidden" name={name} value={parsed.kobo === null ? '' : parsed.kobo.toString()} />

      {invalid ? (
        <ul id={`${id}-error`} className="space-y-0.5">
          {shownErrors.map((error) => (
            <li key={error} className="text-[12px] text-danger-700">
              {error}
            </li>
          ))}
        </ul>
      ) : (
        <p id={`${id}-words`} className="min-h-[18px] text-[12px] text-ink-500">
          {parsed.words ?? hint ?? ''}
        </p>
      )}
    </div>
  );
}

function formatPlainFromKobo(value: string): string {
  try {
    const kobo = BigInt(value);
    const negative = kobo < 0n;
    const magnitude = negative ? -kobo : kobo;
    const body = `${magnitude / 100n}.${(magnitude % 100n).toString().padStart(2, '0')}`;
    return negative ? `-${body}` : body;
  } catch {
    return '';
  }
}
