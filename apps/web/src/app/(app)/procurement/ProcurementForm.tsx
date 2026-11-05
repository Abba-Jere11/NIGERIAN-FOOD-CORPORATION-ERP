'use client';

import { useMemo, useRef, useState, type FormEvent } from 'react';
import type {
  BudgetLineView,
  DepartmentView,
  FundingSourceView,
  ProcurementCategoryView,
  ProcurementView,
  ProjectView,
  UnitOfMeasureView,
  VendorListItemView,
} from '@nfc/shared';
import {
  PAYMENT_TIMINGS,
  PAYMENT_TIMING_LABELS,
  PROCUREMENT_URGENCIES,
  PROCUREMENT_URGENCY_LABELS,
  VENDOR_SELECTABLE_STATUSES,
  amountInWords,
  formatKobo,
  multiplyKoboByQuantity,
} from '@nfc/shared';
import { IDLE_ACTION_RESULT } from '@/lib/action-result';
import { useDraftAutosave } from '@/lib/use-draft-autosave';
import { toastMessageFor, useToastAction } from '@/lib/use-toast-action';
import { AutosaveStatus } from '@/components/forms/AutosaveStatus';
import { DraftVersionInput, useDraftVersion } from '@/components/forms/DraftVersion';
import { Button } from '@/components/ui/Button';
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { ErrorState } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { createProcurementAction, updateProcurementAction } from './actions';

export function ProcurementForm({
  request,
  departments,
  categories,
  units,
  fundingSources,
  budgetLines,
  projects,
  vendors,
  prepareMode = false,
}: {
  request?: ProcurementView;
  departments: DepartmentView[];
  categories: ProcurementCategoryView[];
  units: UnitOfMeasureView[];
  fundingSources: FundingSourceView[];
  budgetLines: BudgetLineView[];
  projects: ProjectView[];
  vendors: VendorListItemView[];
  prepareMode?: boolean;
}) {
  if (!request) return <CreateProcurementForm departments={departments} />;
  return (
    <EditProcurementForm
      request={request}
      departments={departments}
      categories={categories}
      units={units}
      fundingSources={fundingSources}
      budgetLines={budgetLines}
      projects={projects}
      vendors={vendors}
      prepareMode={prepareMode}
    />
  );
}

function CreateProcurementForm({ departments }: { departments: DepartmentView[] }) {
  const [state, formAction] = useToastAction(createProcurementAction, {
    errorTitle: 'The request was not created',
  });
  return (
    <form action={formAction} className="space-y-3">
      {state.status === 'error' ? (
        <ErrorState title="The request was not created" message={state.message} requestId={state.requestId} />
      ) : null}
      <TextField label="Title" name="title" required />
      <SelectField
        label="Department"
        name="departmentId"
        options={departments.map((row) => ({ value: row.id, label: row.name }))}
      />
      <Button type="submit" variant="primary">
        Create draft
      </Button>
    </form>
  );
}

function EditProcurementForm({
  request,
  departments,
  categories,
  units,
  fundingSources,
  budgetLines,
  projects,
  vendors,
  prepareMode,
}: {
  request: ProcurementView;
  departments: DepartmentView[];
  categories: ProcurementCategoryView[];
  units: UnitOfMeasureView[];
  fundingSources: FundingSourceView[];
  budgetLines: BudgetLineView[];
  projects: ProjectView[];
  vendors: VendorListItemView[];
  prepareMode: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const draft = useDraftVersion();
  const { toast } = useToast();
  const [lastError, setLastError] = useState<{ message: string; requestId?: string | null } | null>(null);
  const isProposal = Boolean(request.requisitionId);
  const [vendorId, setVendorId] = useState(request.vendorId ?? '');
  const [lineKeys, setLineKeys] = useState(() => {
    if (request.lines && request.lines.length > 0) return request.lines.map((line) => line.id);
    return ['line-0'];
  });
  const [lineQty, setLineQty] = useState<Record<string, string>>(() => {
    const next: Record<string, string> = {};
    for (const line of request.lines ?? []) next[line.id] = String(line.quantity);
    return next;
  });
  const [linePrices, setLinePrices] = useState<Record<string, bigint | null>>(() => {
    const next: Record<string, bigint | null> = {};
    for (const line of request.lines ?? []) next[line.id] = line.unitPriceKobo > 0 ? BigInt(line.unitPriceKobo) : null;
    return next;
  });

  const autosave = useDraftAutosave({
    formRef,
    enabled: true,
    save: (formData) => updateProcurementAction(IDLE_ACTION_RESULT, formData),
    prepare: (formData) => {
      if (draft) formData.set('rowVersion', String(draft.current()));
    },
    onResult: (result) => {
      if (result.status === 'ok') {
        draft?.advance(result.rowVersion);
        setLastError(null);
      }
    },
  });

  const selectableVendors = vendors.filter(
    (row) =>
      row.id === vendorId ||
      ((VENDOR_SELECTABLE_STATUSES as readonly string[]).includes(row.status) && !row.complianceExpired),
  );
  const selectedVendor = vendors.find((row) => row.id === vendorId);
  const totalPreview = useMemo(() => {
    let total = 0n;
    let any = false;
    for (const key of lineKeys) {
      const qty = Number.parseInt(lineQty[key] ?? '', 10);
      const price = linePrices[key];
      if (!Number.isFinite(qty) || qty <= 0 || price === undefined || price === null || price <= 0n) continue;
      any = true;
      total += multiplyKoboByQuantity(price, qty);
    }
    return any ? total : null;
  }, [lineKeys, lineQty, linePrices]);

  async function onManualSave(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const result = await autosave.saveNow();
    if (!result) return;
    if (result.status === 'error') setLastError({ message: result.message, requestId: result.requestId });
    const message = toastMessageFor(result, { errorTitle: 'The draft was not saved' });
    if (message) toast(message, result.status === 'ok' ? 'success' : 'error');
  }

  return (
    <form
      ref={formRef}
      className="space-y-3"
      onSubmit={(event) => void onManualSave(event)}
      onChange={() => autosave.schedule()}
    >
      <input type="hidden" name="id" value={request.id} />
      <DraftVersionInput fallback={request.rowVersion} />
      {lastError ? (
        <ErrorState title="The draft was not saved" message={lastError.message} requestId={lastError.requestId ?? null} />
      ) : null}
      <TextField label="Title" name="title" required defaultValue={request.title} readOnly={prepareMode} />
      <TextField
        label="Subject"
        name="subject"
        required
        defaultValue={request.subject ?? ''}
        readOnly={prepareMode}
      />
      <SelectField
        label="Department"
        name="departmentId"
        required
        defaultValue={request.departmentId ?? ''}
        disabled={prepareMode}
        options={departments.map((row) => ({ value: row.id, label: row.name }))}
      />
      {prepareMode && request.departmentId ? (
        <input type="hidden" name="departmentId" value={request.departmentId} />
      ) : null}
      <TextAreaField
        label="Reason for procurement"
        name="reason"
        required
        defaultValue={request.reason ?? ''}
        readOnly={prepareMode}
      />
      <TextAreaField
        label="Description"
        name="description"
        required
        defaultValue={request.description ?? ''}
        readOnly={prepareMode}
      />
      <div className="space-y-3">
        {lineKeys.map((key, index) => {
          const existing = (request.lines ?? []).find((line) => line.id === key) ?? request.lines?.[index];
          return (
            <fieldset key={key} className="space-y-2 rounded border border-ink-200 p-3">
              <legend className="text-[12px] font-semibold text-ink-800">Line {index + 1}</legend>
              <TextField
                label="Line description"
                name={`lines[${index}].description`}
                defaultValue={existing?.description ?? ''}
              />
              <SelectField
                label="Category"
                name={`lines[${index}].categoryId`}
                required
                defaultValue={existing?.categoryId ?? ''}
                options={categories.map((row) => ({ value: row.id, label: row.name }))}
              />
              <TextField
                label="Quantity"
                name={`lines[${index}].quantity`}
                type="number"
                required
                readOnly={prepareMode}
                value={lineQty[key] ?? (existing ? String(existing.quantity) : '')}
                onChange={(event) => setLineQty((current) => ({ ...current, [key]: event.target.value }))}
              />
              <SelectField
                label="Unit"
                name={`lines[${index}].unitId`}
                required
                disabled={prepareMode}
                defaultValue={existing?.unitId ?? ''}
                options={units.map((row) => ({ value: row.id, label: `${row.name} (${row.code})` }))}
              />
              {prepareMode && existing?.unitId ? (
                <input type="hidden" name={`lines[${index}].unitId`} value={existing.unitId} />
              ) : null}
              {isProposal || prepareMode ? (
                <p className="text-[13px] text-ink-600" data-testid="line-unit-price-pending">
                  Unit price: {existing && existing.unitPriceKobo > 0 ? formatKobo(BigInt(existing.unitPriceKobo)) : '—'}
                  <span className="block text-[12px] text-ink-500">
                    Filled from the selected vendor quotation when the Managing Director approves.
                  </span>
                </p>
              ) : (
                <MoneyInput
                  label="Unit price"
                  name={`lines[${index}].unitPriceKobo`}
                  required
                  defaultKobo={existing && existing.unitPriceKobo > 0 ? String(existing.unitPriceKobo) : undefined}
                  onKoboChange={(value) => setLinePrices((current) => ({ ...current, [key]: value }))}
                />
              )}
              <SelectField
                label="Budget line"
                name={`lines[${index}].budgetLineId`}
                required
                defaultValue={existing?.budgetLineId ?? ''}
                options={budgetLines.map((row) => ({
                  value: row.id,
                  label: `${row.code} — ${row.name} (${row.fiscalYear})`,
                }))}
              />
              {lineKeys.length > 1 && !prepareMode ? (
                <Button
                  type="button"
                  onClick={() => {
                    setLineKeys((current) => current.filter((item) => item !== key));
                    setLineQty((current) => {
                      const next = { ...current };
                      delete next[key];
                      return next;
                    });
                    setLinePrices((current) => {
                      const next = { ...current };
                      delete next[key];
                      return next;
                    });
                    autosave.schedule();
                  }}
                >
                  Remove line
                </Button>
              ) : null}
            </fieldset>
          );
        })}
        {prepareMode ? null : (
          <Button type="button" onClick={() => setLineKeys((current) => [...current, `line-${Date.now()}`])}>
            Add line
          </Button>
        )}
      </div>
      <p className="text-[13px] text-ink-700">
        Total (server-computed on save):{' '}
        {totalPreview === null ? '—' : `${formatKobo(totalPreview)} · ${amountInWords(totalPreview)}`}
      </p>
      <TextField
        label="Required date"
        name="requiredDate"
        type="date"
        required
        readOnly={prepareMode}
        defaultValue={request.requiredDate ?? ''}
      />
      {isProposal ? (
        <p className="border-l-2 border-ink-300 bg-surface-muted px-3 py-2 text-[13px] text-ink-700">
          Vendor:{' '}
          <span className="font-medium text-ink-900">{request.vendorName ?? 'not selected yet'}</span>. Choose the
          vendor in <a className="underline" href="#price-comparison">Vendor quotations and price comparison</a>{' '}
          below.
        </p>
      ) : (
        <>
          <SelectField
            label="Vendor"
            name="vendorId"
            required
            value={vendorId}
            onChange={(event) => setVendorId(event.target.value)}
            options={selectableVendors.map((row) => ({
              value: row.id,
              label: `${row.legalName} (${row.referenceNumber})`,
            }))}
          />
          {selectedVendor || request.vendorName ? (
            <p className="text-[12px] text-ink-600">
              CAC {request.vendorCac ?? selectedVendor?.cacRegistrationNumber ?? '—'}. Contact{' '}
              {[request.vendorContactName, request.vendorContactPhone, request.vendorContactEmail]
                .filter(Boolean)
                .join(' · ') || 'is taken from the vendor master and cannot be typed here'}
              .
            </p>
          ) : null}
        </>
      )}
      <TextField
        label="Delivery location"
        name="deliveryLocation"
        required
        readOnly={prepareMode}
        defaultValue={request.deliveryLocation ?? ''}
      />
      <SelectField
        label="Funding source"
        name="fundingSourceId"
        required
        defaultValue={request.fundingSourceId ?? ''}
        options={fundingSources.map((row) => ({ value: row.id, label: row.label }))}
      />
      <fieldset className="space-y-2">
        <legend className="text-[12px] font-semibold text-ink-700">
          When should the vendor be paid?
          <span className="ml-0.5 text-danger-600" aria-hidden="true">
            *
          </span>
        </legend>
        {PAYMENT_TIMINGS.map((timing) => (
          <label key={timing} className="flex items-start gap-2 text-[13px] text-ink-800">
            <input
              type="radio"
              name="proposedPaymentTiming"
              value={timing}
              required
              defaultChecked={request.proposedPaymentTiming === timing}
              className="mt-1"
            />
            <span>{PAYMENT_TIMING_LABELS[timing]}</span>
          </label>
        ))}
      </fieldset>
      <SelectField
        label="Project"
        name="projectId"
        defaultValue={request.projectId ?? ''}
        options={[
          { value: '', label: 'None' },
          ...projects.map((row) => ({ value: row.id, label: `${row.code} — ${row.name}` })),
        ]}
      />
      <SelectField
        label="Urgency"
        name="urgency"
        defaultValue={request.urgency}
        options={PROCUREMENT_URGENCIES.map((row) => ({ value: row, label: PROCUREMENT_URGENCY_LABELS[row] }))}
      />
      <TextAreaField
        label="Additional instructions"
        name="additionalInstructions"
        defaultValue={request.additionalInstructions ?? ''}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" disabled={autosave.status.state === 'saving'}>
          Save draft
        </Button>
        <AutosaveStatus status={autosave.status} />
      </div>
    </form>
  );
}
