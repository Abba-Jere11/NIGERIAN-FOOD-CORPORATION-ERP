'use client';

import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { useId } from 'react';
import { cx } from '@/lib/cx';

/**
 * Form fields with server-error display.
 *
 * Errors come from the API's field-keyed 400 response, so the message a user
 * sees is the one the server actually enforced, never a second client-side
 * opinion that might disagree with it.
 */

const CONTROL_CLASS =
  'block w-full border border-ink-300 bg-surface px-2 py-1.5 text-sm text-ink-900 ' +
  'placeholder:text-ink-400 disabled:bg-surface-muted disabled:text-ink-500 ' +
  'aria-[invalid=true]:border-danger-600';

function FieldFrame({
  id,
  label,
  hint,
  errors,
  required,
  children,
  className,
}: {
  id: string;
  label: string;
  hint?: string;
  errors?: string[];
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const hasErrors = Boolean(errors && errors.length > 0);
  return (
    <div className={cx('space-y-1', className)}>
      <label htmlFor={id} className="block text-[12px] font-semibold text-ink-700">
        {label}
        {required ? (
          <span className="ml-0.5 text-danger-600" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      {children}
      {hint && !hasErrors ? <p className="text-[12px] text-ink-500">{hint}</p> : null}
      {hasErrors ? (
        <ul id={`${id}-error`} className="space-y-0.5">
          {errors?.map((error) => (
            <li key={error} className="text-[12px] text-danger-700">
              {error}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  hint?: string;
  errors?: string[];
  fieldClassName?: string;
}

export function TextField({
  label,
  hint,
  errors,
  fieldClassName,
  required,
  ...rest
}: TextFieldProps) {
  const id = useId();
  const invalid = Boolean(errors && errors.length > 0);
  return (
    <FieldFrame
      id={id}
      label={label}
      hint={hint}
      errors={errors}
      required={required}
      className={fieldClassName}
    >
      <input
        id={id}
        required={required}
        aria-invalid={invalid}
        aria-describedby={invalid ? `${id}-error` : undefined}
        className={CONTROL_CLASS}
        {...rest}
      />
    </FieldFrame>
  );
}

export interface TextAreaFieldProps extends Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  'id'
> {
  label: string;
  hint?: string;
  errors?: string[];
}

export function TextAreaField({ label, hint, errors, required, ...rest }: TextAreaFieldProps) {
  const id = useId();
  const invalid = Boolean(errors && errors.length > 0);
  return (
    <FieldFrame id={id} label={label} hint={hint} errors={errors} required={required}>
      <textarea
        id={id}
        required={required}
        aria-invalid={invalid}
        aria-describedby={invalid ? `${id}-error` : undefined}
        rows={rest.rows ?? 3}
        className={CONTROL_CLASS}
        {...rest}
      />
    </FieldFrame>
  );
}

export interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  label: string;
  hint?: string;
  errors?: string[];
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
}

export function SelectField({
  label,
  hint,
  errors,
  options,
  placeholder,
  required,
  ...rest
}: SelectFieldProps) {
  const id = useId();
  const invalid = Boolean(errors && errors.length > 0);
  return (
    <FieldFrame id={id} label={label} hint={hint} errors={errors} required={required}>
      <select
        id={id}
        required={required}
        aria-invalid={invalid}
        aria-describedby={invalid ? `${id}-error` : undefined}
        className={CONTROL_CLASS}
        {...rest}
      >
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldFrame>
  );
}

/**
 * Date input. The browser control stores and submits ISO `YYYY-MM-DD`, and the
 * hint states the display convention so the two are never confused (A7).
 */
export function DateField({
  label,
  hint = 'Displayed as DD/MM/YYYY (Africa/Lagos).',
  errors,
  required,
  ...rest
}: Omit<TextFieldProps, 'type'>) {
  return (
    <TextField
      label={label}
      hint={hint}
      errors={errors}
      required={required}
      type="date"
      {...rest}
    />
  );
}

export { CONTROL_CLASS };
