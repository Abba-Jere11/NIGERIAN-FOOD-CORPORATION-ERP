'use client';

import { useActionState, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { IDLE_ACTION_RESULT, type ActionResult } from '@/lib/action-result';
import { cx } from '@/lib/cx';
import { Button, type ButtonSize, type ButtonVariant } from './Button';
import { ErrorState } from './States';
import { useToast } from './Toast';

/**
 * Modal dialogs built on the native `<dialog>` element, so focus trapping,
 * Escape to close and the backdrop come from the browser rather than from a
 * dependency.
 */
function Modal({
  open,
  onClose,
  title,
  description,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
      className={cx(
        'w-[min(32rem,calc(100vw-2rem))] border border-ink-300 bg-surface p-0 text-ink-900',
        'backdrop:bg-ink-900/40',
      )}
    >
      <div className="border-b border-ink-200 px-4 py-3">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {description ? <p className="mt-0.5 text-[13px] text-ink-500">{description}</p> : null}
      </div>
      {children}
    </dialog>
  );
}

function SubmitButton({ label, variant }: { label: string; variant: ButtonVariant }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending}>
      {pending ? 'Working\u2026' : label}
    </Button>
  );
}

export interface ActionDialogProps {
  triggerLabel: string;
  triggerVariant?: ButtonVariant;
  triggerSize?: ButtonSize;
  triggerDisabled?: boolean;
  title: string;
  description?: string;
  submitLabel: string;
  submitVariant?: ButtonVariant;
  successMessage: string;
  action: (previous: ActionResult, formData: FormData) => Promise<ActionResult>;
  /** Values the action needs, such as the record id and its row version. */
  hiddenFields?: Record<string, string>;
  /**
   * Rule R11: when true the dialog requires a typed reason before it will
   * submit, and the reason is what gets stored permanently.
   */
  requireReason?: boolean;
  reasonLabel?: string;
  reasonHint?: string;
  /**
   * Extra fields. Given the action's result so a field can display the error the
   * server returned for it rather than a second client-side opinion.
   */
  children?: ReactNode | ((state: ActionResult) => ReactNode);
}

/**
 * A dialog that runs a server action. Used for confirmations and, with
 * `requireReason`, for the mandatory-reason flows in rule R11.
 */
export function ActionDialog({
  triggerLabel,
  triggerVariant = 'secondary',
  triggerSize = 'sm',
  triggerDisabled,
  title,
  description,
  submitLabel,
  submitVariant = 'primary',
  successMessage,
  action,
  hiddenFields = {},
  requireReason = false,
  reasonLabel = 'Reason',
  reasonHint = 'Stored permanently and shown to everyone who reviews this record.',
  children,
}: ActionDialogProps) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const reasonId = useId();

  // The dialog closes from inside the action, once the server has actually
  // accepted the change. Closing on submit instead would tell the user it worked
  // before anyone knows whether it did.
  const [state, formAction] = useActionState(
    async (previous: ActionResult, formData: FormData): Promise<ActionResult> => {
      const result = await action(previous, formData);
      if (result.status === 'ok') {
        toast(successMessage, 'success');
        setOpen(false);
      }
      return result;
    },
    IDLE_ACTION_RESULT,
  );

  const reasonErrors = state.status === 'error' ? state.fieldErrors?.reason : undefined;

  return (
    <>
      <Button
        variant={triggerVariant}
        size={triggerSize}
        disabled={triggerDisabled}
        onClick={() => setOpen(true)}
      >
        {triggerLabel}
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} title={title} description={description}>
        <form action={formAction}>
          <div className="space-y-3 px-4 py-4">
            {Object.entries(hiddenFields).map(([name, value]) => (
              <input key={name} type="hidden" name={name} value={value} />
            ))}

            {typeof children === 'function' ? children(state) : children}

            {requireReason ? (
              <div className="space-y-1">
                <label htmlFor={reasonId} className="block text-[12px] font-semibold text-ink-700">
                  {reasonLabel}
                  <span className="ml-0.5 text-danger-600" aria-hidden="true">
                    *
                  </span>
                </label>
                <textarea
                  id={reasonId}
                  name="reason"
                  required
                  minLength={5}
                  rows={3}
                  aria-invalid={Boolean(reasonErrors)}
                  className="block w-full border border-ink-300 bg-surface px-2 py-1.5 text-sm aria-[invalid=true]:border-danger-600"
                />
                {reasonErrors ? (
                  <ul className="space-y-0.5">
                    {reasonErrors.map((error) => (
                      <li key={error} className="text-[12px] text-danger-700">
                        {error}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[12px] text-ink-500">{reasonHint}</p>
                )}
              </div>
            ) : null}

            {state.status === 'error' && !reasonErrors ? (
              <ErrorState
                title="This could not be completed"
                message={state.message}
                requestId={state.requestId ?? null}
              />
            ) : null}
          </div>

          <div className="flex justify-end gap-2 border-t border-ink-200 bg-surface-muted px-4 py-3">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <SubmitButton label={submitLabel} variant={submitVariant} />
          </div>
        </form>
      </Modal>
    </>
  );
}
