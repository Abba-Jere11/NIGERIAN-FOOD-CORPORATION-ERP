'use client';

import type { EntityView } from '@nfc/shared';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';
import { StatusBadge } from '@/components/ui/StatusBadge';

export function EntitiesTable({ entities }: { entities: EntityView[] }) {
  const columns: Array<DataTableColumn<EntityView>> = [
    {
      key: 'code',
      header: 'Code',
      sortable: true,
      width: '6rem',
      value: (row) => row.code,
      render: (row) => <span className="font-mono text-[12px]">{row.code}</span>,
    },
    { key: 'name', header: 'Name', sortable: true, value: (row) => row.name },
    {
      key: 'legalName',
      header: 'Registered name',
      secondary: true,
      sortable: true,
      value: (row) => row.legalName,
    },
    {
      key: 'type',
      header: 'Type',
      sortable: true,
      width: '7rem',
      value: (row) => row.type,
      render: (row) =>
        row.type === 'HOLDING' ? (
          <StatusBadge status="HOLDING" tone="info" />
        ) : (
          <span className="text-ink-600">Subsidiary</span>
        ),
    },
    {
      key: 'departments',
      header: 'Departments',
      align: 'right',
      sortable: true,
      width: '8rem',
      value: (row) => row.activeDepartmentCount,
      render: (row) =>
        row.departmentCount === row.activeDepartmentCount
          ? String(row.departmentCount)
          : `${row.activeDepartmentCount} of ${row.departmentCount}`,
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      width: '7rem',
      value: (row) => row.status,
      render: (row) => <StatusBadge status={row.status} />,
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={entities}
      rowKey={(row) => row.id}
      caption="Entities in the group"
      filterPlaceholder="Filter by code or name"
      exportFileName="nfc-entities"
      rowHref={(row) => `/admin/entities/${row.id}`}
      emptyTitle="No entities are visible to you"
      emptyDescription="Run pnpm db:seed to create the holding company and its four subsidiaries."
    />
  );
}
