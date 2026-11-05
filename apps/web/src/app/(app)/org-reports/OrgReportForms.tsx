'use client';

import { useActionState, useMemo, useState } from 'react';
import type {
  OrgMinuteView,
  OrgReportPersonView,
  OrgReportTemplateView,
  OrgReportView,
} from '@nfc/shared';
import { IDLE_ACTION_RESULT } from '@/lib/action-result';
import { Button } from '@/components/ui/Button';
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field';
import { ErrorState } from '@/components/ui/States';
import {
  amendReportAction,
  closeReportAction,
  createReportAction,
  forwardReportAction,
  issueMinuteAction,
  minuteWorkflowAction,
  recordDecisionAction,
  reviewResponseAction,
  saveDraftAction,
  sendExternalAction,
  submitReportAction,
  submitResponseAction,
  updateTemplateAction,
  uploadAttachmentAction,
} from './actions';

function newKey(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `web-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function CreateReportForm({
  entities,
  templates,
  people,
}: {
  entities: Array<{ id: string; code: string; name: string }>;
  templates: OrgReportTemplateView[];
  people: OrgReportPersonView[];
}) {
  const [state, formAction] = useActionState(createReportAction, IDLE_ACTION_RESULT);
  const [preview, setPreview] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [templateKey, setTemplateKey] = useState('');
  const [entityId, setEntityId] = useState(entities.length === 1 ? entities[0]!.id : '');
  const key = useMemo(() => newKey(), []);
  const fieldErrors = state.status === 'error' ? state.fieldErrors : undefined;

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="idempotencyKey" value={key} />
      {state.status === 'error' ? (
        <ErrorState title="The report was not saved" message={state.message} requestId={state.requestId} />
      ) : null}
      <SelectField
        label="Report type"
        name="templateKey"
        required
        placeholder="Choose a category"
        value={templateKey}
        onChange={(event) => setTemplateKey(event.target.value)}
        errors={fieldErrors?.templateKey}
        options={templates.map((row) => ({ value: row.key, label: row.title }))}
      />
      <SelectField
        label="Subsidiary or corporate unit"
        name="entityId"
        required
        placeholder="Choose the originating unit"
        value={entityId}
        onChange={(event) => setEntityId(event.target.value)}
        errors={fieldErrors?.entityId}
        options={entities.map((row) => ({ value: row.id, label: `${row.code} — ${row.name}` }))}
      />
      <TextField
        label="Report title"
        name="title"
        required
        maxLength={240}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        errors={fieldErrors?.title}
      />
      <TextField label="Reporting period" name="reportingPeriod" maxLength={120} />
      <TextField label="Date of report" name="reportDate" type="date" />
      <p className="text-[12px] text-ink-500">To: Managing Director (locked). CC is optional and does not assign work.</p>
      <SelectField
        label="CC (optional)"
        name="ccUserIds"
        multiple
        options={people.map((row) => ({ value: row.id, label: row.name }))}
      />
      <TextAreaField
        label="Report body"
        name="body"
        required
        rows={10}
        maxLength={20000}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        errors={fieldErrors?.body}
      />
      <TextAreaField label="Observations or recommendations" name="observations" rows={4} maxLength={8000} />
      {preview ? (
        <div className="border border-ink-200 bg-surface-muted px-3 py-2 text-[13px]">
          <p className="font-semibold">Preview</p>
          <p className="mt-1 font-medium">{title || 'Untitled'}</p>
          <p className="mt-2 whitespace-pre-wrap">{body || 'No body yet.'}</p>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="subtle" onClick={() => setPreview((value) => !value)}>
          Preview
        </Button>
        <Button
          type="submit"
          variant="secondary"
          formAction={(formData) => {
            formData.set('intent', 'draft');
            return formAction(formData);
          }}
        >
          Save draft
        </Button>
        <Button
          type="submit"
          variant="primary"
          formAction={(formData) => {
            formData.set('intent', 'submit');
            return formAction(formData);
          }}
        >
          Submit report
        </Button>
      </div>
    </form>
  );
}

export function DraftActions({ report }: { report: OrgReportView }) {
  const [state, formAction] = useActionState(saveDraftAction, IDLE_ACTION_RESULT);
  const [submitState, submitAction] = useActionState(submitReportAction, IDLE_ACTION_RESULT);
  const key = useMemo(() => newKey(), []);
  return (
    <div className="space-y-4">
      <form action={formAction} className="space-y-3">
        <input type="hidden" name="id" value={report.id} />
        <input type="hidden" name="rowVersion" value={report.rowVersion} />
        {state.status === 'error' ? <ErrorState title="Draft not saved" message={state.message} /> : null}
        {state.status === 'ok' ? <p className="text-[13px]">{state.message}</p> : null}
        <TextField label="Report title" name="title" required defaultValue={report.title} />
        <TextAreaField label="Report body" name="body" required rows={8} defaultValue={report.body} />
        <TextAreaField label="Observations" name="observations" rows={3} defaultValue={report.observations ?? ''} />
        <Button type="submit">Save draft</Button>
      </form>
      <form action={submitAction}>
        <input type="hidden" name="id" value={report.id} />
        <input type="hidden" name="rowVersion" value={report.rowVersion} />
        <input type="hidden" name="idempotencyKey" value={key} />
        {submitState.status === 'error' ? (
          <ErrorState title="Submission failed" message={submitState.message} requestId={submitState.requestId} />
        ) : null}
        <Button type="submit" variant="primary">
          Submit report
        </Button>
      </form>
    </div>
  );
}

export function ForwardForm({
  report,
  people,
}: {
  report: OrgReportView;
  people: OrgReportPersonView[];
}) {
  const [state, formAction] = useActionState(forwardReportAction, IDLE_ACTION_RESULT);
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="id" value={report.id} />
      <input type="hidden" name="rowVersion" value={report.rowVersion} />
      {state.status === 'error' ? <ErrorState title="Forwarding failed" message={state.message} /> : null}
      {state.status === 'ok' ? <p className="text-[13px]">{state.message}</p> : null}
      <p className="text-[12px] text-ink-600">
        Original: From {report.senderName} · To {report.originalTo?.name ?? 'Managing Director'} · CC{' '}
        {report.originalCc.length > 0 ? report.originalCc.map((item) => item.name).join(', ') : 'None'}
      </p>
      <SelectField
        label="Additional internal recipients"
        name="userIds"
        required
        multiple
        options={people.map((row) => ({ value: row.id, label: row.name }))}
      />
      <TextAreaField label="Forwarding note (optional)" name="note" rows={3} />
      <Button type="submit" variant="primary">
        Confirm forward
      </Button>
    </form>
  );
}

export function MinuteForm({
  report,
  people,
}: {
  report: OrgReportView;
  people: OrgReportPersonView[];
}) {
  const [state, formAction] = useActionState(issueMinuteAction, IDLE_ACTION_RESULT);
  const key = useMemo(() => newKey(), []);
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="reportId" value={report.id} />
      <input type="hidden" name="idempotencyKey" value={key} />
      {state.status === 'error' ? <ErrorState title="The minute was not issued" message={state.message} /> : null}
      <TextField label="Subject" name="subject" required defaultValue={`Action required — ${report.title}`} />
      <SelectField
        label="To (assigned officer)"
        name="toUserId"
        required
        placeholder="Choose the officer responsible"
        options={people.map((row) => ({ value: row.id, label: row.name }))}
      />
      <SelectField
        label="CC (review before issue)"
        name="ccUserIds"
        multiple
        defaultValue={[report.senderUserId]}
        options={people.concat([{ id: report.senderUserId, name: report.senderName ?? 'Original sender' }]).map((row) => ({
          value: row.id,
          label: row.name,
        }))}
      />
      <TextAreaField label="Instruction or request" name="instruction" required rows={6} />
      <TextAreaField label="Expected outcome" name="expectedOutcome" rows={3} />
      <TextField label="Due date" name="dueAt" type="datetime-local" />
      <SelectField
        label="Response required"
        name="responseRequired"
        options={[
          { value: 'yes', label: 'Yes' },
          { value: 'no', label: 'No' },
        ]}
        defaultValue="yes"
      />
      <SelectField
        label="Acknowledgement required"
        name="acknowledgementRequired"
        options={[
          { value: 'no', label: 'No' },
          { value: 'yes', label: 'Yes' },
        ]}
        defaultValue="no"
      />
      <SelectField
        label="Priority"
        name="priority"
        options={[
          { value: 'NORMAL', label: 'Normal' },
          { value: 'HIGH', label: 'High' },
          { value: 'LOW', label: 'Low' },
        ]}
      />
      <div className="flex gap-2">
        <Button type="submit" name="intent" value="draft">
          Save draft
        </Button>
        <Button type="submit" variant="primary" name="intent" value="issue">
          Issue minute
        </Button>
      </div>
    </form>
  );
}

export function ResponseForm({ minute }: { minute: OrgMinuteView }) {
  const [state, formAction] = useActionState(submitResponseAction, IDLE_ACTION_RESULT);
  const key = useMemo(() => newKey(), []);
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="id" value={minute.id} />
      <input type="hidden" name="entityId" value={minute.entityId} />
      <input type="hidden" name="idempotencyKey" value={key} />
      {state.status === 'error' ? <ErrorState title="Response not submitted" message={state.message} /> : null}
      {state.status === 'ok' ? <p className="text-[13px]">{state.message}</p> : null}
      <TextField label="Response subject" name="subject" required defaultValue={`Response — ${minute.subject}`} />
      <TextAreaField label="Response body" name="body" required rows={6} />
      <TextAreaField label="Outcome or findings" name="outcome" rows={3} />
      <TextField label="Supporting evidence" name="file" type="file" />
      <Button type="submit" variant="primary">
        Submit response
      </Button>
    </form>
  );
}

export function ReviewForm({ minute }: { minute: OrgMinuteView }) {
  const [state, formAction] = useActionState(reviewResponseAction, IDLE_ACTION_RESULT);
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="id" value={minute.id} />
      <input type="hidden" name="rowVersion" value={minute.rowVersion} />
      {state.status === 'error' ? <ErrorState title="Review failed" message={state.message} /> : null}
      {state.status === 'ok' ? <p className="text-[13px]">{state.message}</p> : null}
      <SelectField
        label="Review action"
        name="action"
        required
        options={[
          { value: 'accept', label: 'Accept and complete' },
          { value: 'further', label: 'Request further action' },
          { value: 'reopen', label: 'Reopen' },
        ]}
      />
      <TextAreaField label="Explanation" name="note" rows={3} />
      <Button type="submit" variant="primary">
        Record review
      </Button>
    </form>
  );
}

export function DecisionForm({ report }: { report: OrgReportView }) {
  const [state, formAction] = useActionState(recordDecisionAction, IDLE_ACTION_RESULT);
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="id" value={report.id} />
      {state.status === 'error' ? <ErrorState title="Decision not recorded" message={state.message} /> : null}
      {state.status === 'ok' ? <p className="text-[13px]">{state.message}</p> : null}
      <TextField label="Decision subject" name="subject" required defaultValue={report.title} />
      <TextAreaField label="Decision text" name="body" required rows={5} />
      {report.minutes.length > 0 ? (
        <SelectField
          label="Related minute (optional)"
          name="minuteId"
          options={report.minutes.map((item) => ({ value: item.id, label: item.referenceNumber }))}
        />
      ) : null}
      <Button type="submit" variant="primary">
        Record decision
      </Button>
    </form>
  );
}

export function ExternalForm({ report }: { report: OrgReportView }) {
  const [state, formAction] = useActionState(sendExternalAction, IDLE_ACTION_RESULT);
  const key = useMemo(() => newKey(), []);
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="id" value={report.id} />
      <input type="hidden" name="idempotencyKey" value={key} />
      {state.status === 'error' ? <ErrorState title="External send failed" message={state.message} /> : null}
      {state.status === 'ok' ? <p className="text-[13px]">{state.message}</p> : null}
      <TextField label="External recipient email" name="recipientEmail" type="email" required />
      <TextField label="Subject" name="subject" required defaultValue={report.title} />
      <TextAreaField label="Email message" name="message" required rows={5} />
      <Button type="submit" variant="primary">
        Send
      </Button>
    </form>
  );
}

export function AttachmentForm({
  ownerId,
  ownerType,
  entityId,
}: {
  ownerId: string;
  ownerType: string;
  entityId: string;
}) {
  const [state, formAction] = useActionState(uploadAttachmentAction, IDLE_ACTION_RESULT);
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="ownerId" value={ownerId} />
      <input type="hidden" name="ownerType" value={ownerType} />
      <input type="hidden" name="entityId" value={entityId} />
      {state.status === 'error' ? <ErrorState title="Upload failed" message={state.message} /> : null}
      {state.status === 'ok' ? <p className="text-[13px]">{state.message}</p> : null}
      <TextField label="Supporting file" name="file" type="file" required />
      <Button type="submit" size="sm">
        Attach
      </Button>
    </form>
  );
}

export function CloseForm({ report }: { report: OrgReportView }) {
  const [state, formAction] = useActionState(closeReportAction, IDLE_ACTION_RESULT);
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="id" value={report.id} />
      <input type="hidden" name="rowVersion" value={report.rowVersion} />
      {state.status === 'error' ? <ErrorState title="Status not updated" message={state.message} /> : null}
      <SelectField
        label="Close or archive"
        name="status"
        options={[
          { value: 'CLOSED', label: 'Close' },
          { value: 'ARCHIVED', label: 'Archive' },
        ]}
      />
      <Button type="submit" size="sm">
        Update report status
      </Button>
    </form>
  );
}

export function AmendForm({ report }: { report: OrgReportView }) {
  const [state, formAction] = useActionState(amendReportAction, IDLE_ACTION_RESULT);
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="id" value={report.id} />
      <input type="hidden" name="rowVersion" value={report.rowVersion} />
      {state.status === 'error' ? <ErrorState title="Amendment failed" message={state.message} /> : null}
      {state.status === 'ok' ? <p className="text-[13px]">{state.message}</p> : null}
      <TextAreaField label="Amended body" name="body" rows={5} defaultValue={report.body} />
      <TextField label="Reason" name="reason" required />
      <Button type="submit" size="sm">
        Record amendment
      </Button>
    </form>
  );
}

export function MinuteButton({
  minuteId,
  rowVersion,
  path,
  label,
}: {
  minuteId: string;
  rowVersion: number;
  path: string;
  label: string;
}) {
  const [state, formAction] = useActionState(minuteWorkflowAction, IDLE_ACTION_RESULT);
  return (
    <form action={formAction} className="inline-block">
      <input type="hidden" name="id" value={minuteId} />
      <input type="hidden" name="rowVersion" value={rowVersion} />
      <input type="hidden" name="path" value={path} />
      {state.status === 'error' ? <ErrorState title="Update failed" message={state.message} /> : null}
      <Button type="submit" size="sm">
        {label}
      </Button>
    </form>
  );
}

export function TemplateForm({
  id,
  title,
  available,
  rowVersion,
}: {
  id: string;
  title: string;
  available: boolean;
  rowVersion: number;
}) {
  const [state, formAction] = useActionState(updateTemplateAction, IDLE_ACTION_RESULT);
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="rowVersion" value={rowVersion} />
      <TextField label="Title" name="title" defaultValue={title} />
      <SelectField
        label="Available"
        name="available"
        defaultValue={available ? 'yes' : 'no'}
        options={[
          { value: 'yes', label: 'Yes' },
          { value: 'no', label: 'No' },
        ]}
      />
      <Button type="submit" size="sm">
        Save
      </Button>
      {state.status === 'error' ? <ErrorState title="Not saved" message={state.message} /> : null}
    </form>
  );
}
