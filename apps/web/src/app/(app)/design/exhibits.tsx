'use client';

import { Button } from '@/components/ui/Button';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';
import { ActionDialog } from '@/components/ui/Dialog';
import { DateField, SelectField, TextAreaField, TextField } from '@/components/ui/Field';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useToast } from '@/components/ui/Toast';
import { demoConfirm, demoFails, demoWithReason } from './demo-actions';

export function DesignFormExhibit() {
  return (
    <form className="grid max-w-2xl grid-cols-1 gap-4 sm:grid-cols-2">
      <TextField label="Subsidiary name" name="name" required defaultValue="Yuci Flour Zaria" />
      <TextField
        label="Code"
        name="code"
        required
        defaultValue="yfz"
        errors={['Use capital letters and digits only, for example YFZ.']}
      />
      <SelectField
        label="Department"
        name="department"
        required
        placeholder="Choose a department"
        options={[
          { value: 'operations', label: 'Operations' },
          { value: 'finance', label: 'Finance' },
          { value: 'production', label: 'Production' },
        ]}
      />
      <DateField label="Required by" name="requiredBy" required />
      <MoneyInput name="amountKobo" label="Amount" required defaultKobo="450050" />
      <TextField label="Disabled" name="disabled" disabled defaultValue="Set by the system" />
      <div className="sm:col-span-2">
        <TextAreaField
          label="Description"
          name="description"
          hint="Plain description of what this is for."
        />
      </div>
    </form>
  );
}

interface DemoRow {
  reference: string;
  vendor: string;
  entity: string;
  amountKobo: string;
  status: string;
  raisedAt: string;
}

const DEMO_ROWS: DemoRow[] = [
  {
    reference: 'YFZ/PR/2026/0031',
    vendor: 'Kaduna Grain Traders',
    entity: 'YFZ',
    amountKobo: '1250050',
    status: 'AWAITING_MD',
    raisedAt: '21/09/2026 09:14',
  },
  {
    reference: 'YFW/PR/2026/0018',
    vendor: 'Northern Sacks Ltd',
    entity: 'YFW',
    amountKobo: '48000000',
    status: 'COMPLETED',
    raisedAt: '18/09/2026 14:40',
  },
  {
    reference: 'DMA/PR/2026/0009',
    vendor: 'Sahel Logistics',
    entity: 'DMA',
    amountKobo: '990000',
    status: 'REJECTED',
    raisedAt: '17/09/2026 08:05',
  },
  {
    reference: 'NOM/PR/2026/0044',
    vendor: 'Benue Oil Mills',
    entity: 'NOM',
    amountKobo: '7350025',
    status: 'AWAITING_ED_FINANCE',
    raisedAt: '16/09/2026 16:22',
  },
];

function nairaFromKobo(kobo: string): string {
  const value = BigInt(kobo);
  const whole = (value / 100n).toLocaleString('en-NG');
  return `${whole}.${(value % 100n).toString().padStart(2, '0')}`;
}

export function DesignTableExhibit() {
  const columns: Array<DataTableColumn<DemoRow>> = [
    {
      key: 'reference',
      header: 'Reference',
      sortable: true,
      value: (row) => row.reference,
      render: (row) => <span className="font-mono text-[12px]">{row.reference}</span>,
    },
    { key: 'vendor', header: 'Vendor', sortable: true, value: (row) => row.vendor },
    { key: 'entity', header: 'Entity', sortable: true, value: (row) => row.entity, width: '5rem' },
    {
      key: 'amount',
      header: 'Amount (₦)',
      align: 'right',
      sortable: true,
      value: (row) => Number(row.amountKobo),
      render: (row) => nairaFromKobo(row.amountKobo),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      value: (row) => row.status,
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'raisedAt',
      header: 'Raised',
      secondary: true,
      sortable: true,
      value: (row) => row.raisedAt,
      render: (row) => <span className="tabular">{row.raisedAt}</span>,
    },
  ];

  return (
    <div className="border border-ink-200">
      <DataTable
        columns={columns}
        rows={DEMO_ROWS}
        rowKey={(row) => row.reference}
        caption="Example requisitions"
        filterPlaceholder="Filter by reference, vendor or status"
        exportFileName="design-example"
        pageSize={3}
      />
    </div>
  );
}

export function DesignToastExhibit() {
  const { toast } = useToast();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ActionDialog
        triggerLabel="Confirm an action"
        triggerVariant="secondary"
        triggerSize="md"
        title="Submit this requisition?"
        description="It will go to the General Manager for approval and can no longer be edited."
        submitLabel="Submit"
        submitVariant="primary"
        successMessage="Requisition submitted."
        action={demoConfirm}
      />

      <ActionDialog
        triggerLabel="Deactivate with a reason"
        triggerVariant="danger"
        triggerSize="md"
        title="Deactivate Yuci Flour Zaria?"
        description="Nothing is deleted. The subsidiary stops accepting new records and its history stays intact."
        submitLabel="Deactivate"
        submitVariant="danger"
        successMessage="Subsidiary deactivated."
        action={demoWithReason}
        requireReason
      />

      <ActionDialog
        triggerLabel="An action that fails"
        triggerSize="md"
        title="Save these changes?"
        submitLabel="Save"
        submitVariant="primary"
        successMessage="Saved."
        action={demoFails}
      />

      <span aria-hidden="true" className="mx-1 h-6 w-px bg-ink-200" />

      <Button onClick={() => toast('Department created.', 'success')}>Success toast</Button>
      <Button onClick={() => toast('That code is already in use.', 'error')}>Error toast</Button>
      <Button onClick={() => toast('Export started.', 'info')}>Info toast</Button>
    </div>
  );
}
