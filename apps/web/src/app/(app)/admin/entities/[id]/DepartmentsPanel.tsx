'use client';

import type { DepartmentView } from '@nfc/shared';
import { formatLagosDateTime } from '@nfc/shared';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';
import { ActionDialog } from '@/components/ui/Dialog';
import { CONTROL_CLASS, TextAreaField, TextField } from '@/components/ui/Field';
import { StatusBadge } from '@/components/ui/StatusBadge';
import type { ActionResult } from '@/lib/action-result';
import { cx } from '@/lib/cx';
import { createDepartment, setDepartmentStatus, updateDepartment } from '../actions';

/**
 * Departments of one subsidiary (M1 item 4).
 *
 * Deactivating a department leaves every row that referenced it untouched: the
 * database has no DELETE privilege for the application role at all, so history
 * cannot be lost here even by mistake (rule R3).
 */
export function DepartmentsPanel({
  entityId,
  entityCode,
  departments,
  canManage,
}: {
  entityId: string;
  entityCode: string;
  departments: DepartmentView[];
  canManage: boolean;
}) {
  const columns: Array<DataTableColumn<DepartmentView>> = [
    { key: 'name', header: 'Department', sortable: true, value: (row) => row.name },
    {
      key: 'code',
      header: 'Code',
      sortable: true,
      width: '6rem',
      value: (row) => row.code ?? '',
      render: (row) =>
        row.code ? (
          <span className="font-mono text-[12px]">{row.code}</span>
        ) : (
          <span className="text-ink-400">—</span>
        ),
    },
    {
      key: 'description',
      header: 'Description',
      secondary: true,
      value: (row) => row.description ?? '',
      render: (row) => row.description ?? <span className="text-ink-400">—</span>,
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      width: '7rem',
      value: (row) => row.status,
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'updatedAt',
      header: 'Last changed',
      secondary: true,
      sortable: true,
      width: '10rem',
      value: (row) => row.updatedAt,
      render: (row) => <span className="tabular">{formatLagosDateTime(row.updatedAt)}</span>,
    },
    ...(canManage
      ? [
          {
            key: 'actions',
            header: 'Actions',
            align: 'right' as const,
            width: '12rem',
            value: () => '',
            render: (row: DepartmentView) => (
              <div className="no-print flex justify-end gap-1.5">
                <DepartmentEditDialog entityId={entityId} department={row} />
                <DepartmentStatusDialog entityId={entityId} department={row} />
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <DataTable
      columns={columns}
      rows={departments}
      rowKey={(row) => row.id}
      caption={`Departments of ${entityCode}`}
      filterPlaceholder="Filter departments"
      exportFileName={`nfc-${entityCode.toLowerCase()}-departments`}
      emptyTitle="No departments yet"
      emptyDescription={
        canManage
          ? 'Add the departments this subsidiary operates. Seven are created by default when the group is seeded.'
          : 'This subsidiary has no departments recorded.'
      }
      emptyAction={canManage ? <CreateDepartmentDialog entityId={entityId} /> : undefined}
    />
  );
}

export function CreateDepartmentDialog({ entityId }: { entityId: string }) {
  return (
    <ActionDialog
      triggerLabel="New department"
      triggerVariant="primary"
      triggerSize="md"
      title="New department"
      description="Department names are unique within a subsidiary, regardless of capitalisation."
      submitLabel="Create department"
      submitVariant="primary"
      successMessage="Department created."
      action={createDepartment}
      hiddenFields={{ entityId }}
    >
      {(state) => <DepartmentFields state={state} />}
    </ActionDialog>
  );
}

function DepartmentEditDialog({
  entityId,
  department,
}: {
  entityId: string;
  department: DepartmentView;
}) {
  return (
    <ActionDialog
      triggerLabel="Edit"
      title={`Edit ${department.name}`}
      submitLabel="Save changes"
      submitVariant="primary"
      successMessage="Changes saved."
      action={updateDepartment}
      hiddenFields={{
        entityId,
        id: department.id,
        rowVersion: String(department.rowVersion),
      }}
    >
      {(state) => <DepartmentFields state={state} department={department} />}
    </ActionDialog>
  );
}

function DepartmentStatusDialog({
  entityId,
  department,
}: {
  entityId: string;
  department: DepartmentView;
}) {
  const isActive = department.status === 'ACTIVE';

  return (
    <ActionDialog
      triggerLabel={isActive ? 'Deactivate' : 'Reactivate'}
      triggerVariant={isActive ? 'danger' : 'secondary'}
      title={isActive ? `Deactivate ${department.name}?` : `Reactivate ${department.name}?`}
      description={
        isActive
          ? 'Nothing is deleted. The department can no longer be chosen for new records, and every record already linked to it keeps its link.'
          : 'The department becomes selectable again.'
      }
      submitLabel={isActive ? 'Deactivate' : 'Reactivate'}
      submitVariant={isActive ? 'danger' : 'primary'}
      successMessage={isActive ? 'Department deactivated.' : 'Department reactivated.'}
      action={setDepartmentStatus}
      hiddenFields={{
        entityId,
        id: department.id,
        rowVersion: String(department.rowVersion),
        target: isActive ? 'INACTIVE' : 'ACTIVE',
      }}
      requireReason
    />
  );
}

function DepartmentFields({
  state,
  department,
}: {
  state: ActionResult;
  department?: DepartmentView;
}) {
  const fieldErrors = state.status === 'error' ? state.fieldErrors : undefined;

  return (
    <>
      <TextField
        label="Name"
        name="name"
        required
        defaultValue={department?.name ?? ''}
        placeholder="Production"
        errors={fieldErrors?.name}
      />
      <TextField
        label="Code"
        name="code"
        maxLength={10}
        defaultValue={department?.code ?? ''}
        placeholder="PROD"
        hint="Optional. Capital letters and digits only."
        className={cx(CONTROL_CLASS, 'font-mono uppercase')}
        errors={fieldErrors?.code}
      />
      <TextAreaField
        label="Description"
        name="description"
        defaultValue={department?.description ?? ''}
        hint="Optional. What this department is responsible for."
        errors={fieldErrors?.description}
      />
    </>
  );
}
