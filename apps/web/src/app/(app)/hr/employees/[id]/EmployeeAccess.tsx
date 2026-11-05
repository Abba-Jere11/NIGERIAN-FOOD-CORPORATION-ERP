'use client';

import { TextField } from '@/components/ui/Field';
import { Surface, SurfaceHeader } from '@/components/ui/Surface';
import { ActionForm } from '@/app/(app)/me/ActionForm';
import { issueInvite, linkEmployeeUser, setDepartmentHead } from '../../portal-actions';

export function EmployeeAccess({
  employeeId,
  departmentId,
  canInvite,
  canSetHead,
}: {
  employeeId: string;
  departmentId: string | null;
  canInvite: boolean;
  canSetHead: boolean;
}) {
  if (!canInvite && !canSetHead) return null;
  return (
    <>
      {canInvite ? (
        <Surface>
          <SurfaceHeader title="Sign-in" description="Sends a 72-hour invite, or links an existing account." />
          <div className="space-y-4 px-4 py-3">
            <ActionForm action={async () => issueInvite(employeeId)} submitLabel="Send invite" />
            <ActionForm action={linkEmployeeUser} submitLabel="Link existing account" variant="secondary">
              <input type="hidden" name="employeeId" value={employeeId} />
              <TextField name="userId" label="User id" required />
            </ActionForm>
          </div>
        </Surface>
      ) : null}
      {canSetHead && departmentId ? (
        <Surface>
          <SurfaceHeader title="Department head" description="This person approves leave after the relief officer." />
          <div className="px-4 py-3">
            <ActionForm action={setDepartmentHead} submitLabel="Set as department head" variant="secondary">
              <input type="hidden" name="departmentId" value={departmentId} />
              <input type="hidden" name="employeeId" value={employeeId} />
            </ActionForm>
          </div>
        </Surface>
      ) : null}
    </>
  );
}
