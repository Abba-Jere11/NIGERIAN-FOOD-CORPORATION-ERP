'use client';

import { useMemo, useState } from 'react';
import type { ReportView } from '@nfc/shared';
import { ActionDialog } from '@/components/ui/Dialog';
import { TextAreaField, TextField } from '@/components/ui/Field';
import { shareReportAction } from './share-actions';

export function ShareReportDialog({
  report,
  kind,
  senderName,
  entityId,
  consolidated,
  periodId,
  year,
  ytd,
}: {
  report: ReportView;
  kind: string;
  senderName: string;
  entityId?: string;
  consolidated: boolean;
  periodId?: string;
  year?: string;
  ytd: boolean;
}) {
  const [recipient, setRecipient] = useState('');
  const [message, setMessage] = useState('');
  const subject = useMemo(
    () => `NFC · ${report.title} · ${report.entityLabel} · ${report.periodLabel} · ${report.runReference}`,
    [report],
  );
  const filename = 'this report as a PDF';

  return (
    <ActionDialog
      triggerLabel="Share by email"
      triggerVariant="secondary"
      title="Share this report"
      description="Sends a branded copy from the Managing Director’s official mailbox. The recipient does not receive access to NFC."
      submitLabel="Send report"
      successMessage="The report was handed to the mail service."
      action={shareReportAction}
      hiddenFields={{
        kind,
        entityId: entityId ?? '',
        consolidated: consolidated ? 'true' : '',
        periodId: periodId ?? '',
        year: year ?? '',
        ytd: ytd ? 'true' : '',
      }}
    >
      {(state) => (
        <>
          <TextField
            label="Recipient"
            name="recipient"
            type="email"
            required
            value={recipient}
            onChange={(event) => setRecipient(event.target.value)}
            placeholder="board@example.com"
            hint="An external address. This does not create an NFC account."
            errors={state.status === 'error' ? state.fieldErrors?.recipient : undefined}
          />
          <TextAreaField
            label="Covering note"
            name="message"
            rows={4}
            maxLength={2000}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            hint="Optional. Shown in the email above the report details."
          />
          <div className="border border-ink-200 bg-surface-muted px-3 py-3 text-[13px] text-ink-800">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">Preview</p>
            <p className="mt-2">
              <span className="text-ink-500">From</span> {senderName} (official NFC mailbox)
            </p>
            <p>
              <span className="text-ink-500">To</span> {recipient || '—'}
            </p>
            <p>
              <span className="text-ink-500">Subject</span> {subject}
            </p>
            <p className="mt-2">Dear colleague,</p>
            <p className="mt-1">
              {senderName}, Managing Director of the Nigeria Food Corporation, is sharing an official
              report with you.
            </p>
            {message.trim() ? (
              <p className="mt-2 border-l-2 border-ink-300 pl-2 whitespace-pre-wrap">{message.trim()}</p>
            ) : null}
            <p className="mt-2 font-mono text-[12px]">
              {report.title} · {report.runReference} · {report.entityLabel} · {report.periodLabel}
            </p>
            <p className="mt-2">Attached: {filename}</p>
          </div>
        </>
      )}
    </ActionDialog>
  );
}
