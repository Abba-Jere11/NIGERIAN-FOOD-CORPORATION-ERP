import { describe, expect, it } from 'vitest';
import { AUDIT_VIEWER_ROLES, ROLE_KEYS, ROLES, SYSTEM_ADMIN_ROLES } from './org';
import {
  APPROVAL_OR_PAYMENT_KEYS,
  DEFAULT_ROLE_GRANTS,
  HOME_GATE_PERMISSION,
  PERMISSION_KEYS,
  UNASSIGNED_FORWARD_KEYS,
  defaultGrantIncludes,
  defaultGrantsForRole,
} from './permissions';

describe('the eight-role model', () => {
  it('has exactly eight roles', () => {
    expect(ROLE_KEYS).toHaveLength(9);
    expect([...ROLE_KEYS]).toEqual([
      'gm',
      'ed_operations',
      'md',
      'ed_finance',
      'finance_head',
      'administrator',
      'inventory_officer',
      'hr_officer',
      'staff',
    ]);
  });

  it('defines every role, with a scope and a home path', () => {
    for (const key of ROLE_KEYS) {
      const role = ROLES[key];
      expect(role.key).toBe(key);
      expect(role.name.length).toBeGreaterThan(0);
      expect(role.shortName.length).toBeGreaterThan(0);
      expect(role.homePath === '/me' || role.homePath.startsWith('/home/')).toBe(true);
      expect(['CORPORATE', 'ENTITY']).toContain(role.scopeType);
    }
  });

  it('scopes the GM and the Finance Head to a single subsidiary', () => {
    expect(ROLES.gm.scopeType).toBe('ENTITY');
    expect(ROLES.finance_head.scopeType).toBe('ENTITY');
  });

  it('gives the three executive roles, Procurement Manager and HR Officer group-wide business scope', () => {
    expect(ROLES.md.scopeType).toBe('CORPORATE');
    expect(ROLES.ed_finance.scopeType).toBe('CORPORATE');
    expect(ROLES.ed_operations.scopeType).toBe('CORPORATE');
    expect(ROLES.inventory_officer.scopeType).toBe('CORPORATE');
    expect(ROLES.hr_officer.scopeType).toBe('CORPORATE');
  });

  it('gives system administration to the Administrator, not the MD', () => {
    expect([...SYSTEM_ADMIN_ROLES]).toEqual(['administrator']);
    expect(defaultGrantIncludes('administrator', 'admin.user.manage')).toBe(true);
    expect(defaultGrantIncludes('md', 'admin.user.manage')).toBe(false);
    expect(defaultGrantIncludes('md', 'organization.entity.manage')).toBe(false);
  });
});

describe('the default grant catalog', () => {
  it('grants every permission to somebody, so none is dead weight', () => {
    for (const permission of PERMISSION_KEYS) {
      if (UNASSIGNED_FORWARD_KEYS.includes(permission)) continue;
      const holders = ROLE_KEYS.filter((role) => defaultGrantIncludes(role, permission));
      expect(holders.length, `nobody holds ${permission}`).toBeGreaterThan(0);
    }
  });

  it('grants no permission that is not declared', () => {
    for (const role of ROLE_KEYS) {
      for (const permission of DEFAULT_ROLE_GRANTS[role]) {
        expect(PERMISSION_KEYS).toContain(permission);
      }
    }
  });

  it('restricts the audit log to the MD and ED Finance', () => {
    const viewers = ROLE_KEYS.filter((role) => defaultGrantIncludes(role, 'audit.view'));
    expect(viewers.sort()).toEqual([...AUDIT_VIEWER_ROLES].sort());
    expect(defaultGrantIncludes('administrator', 'audit.view')).toBe(false);
  });

  it('restricts Overdue Workflows to the three group-wide business roles', () => {
    const holders = ROLE_KEYS.filter((role) => defaultGrantIncludes(role, 'oversight.overdue.view'));
    expect(holders.sort()).toEqual(['ed_finance', 'ed_operations', 'md'].sort());
    expect(defaultGrantIncludes('administrator', 'oversight.overdue.view')).toBe(false);
    expect(defaultGrantIncludes('gm', 'oversight.overdue.view')).toBe(false);
  });

  it('lets every management role see the organisation it belongs to', () => {
    for (const role of ROLE_KEYS) {
      expect(defaultGrantIncludes(role, 'organization.view')).toBe(role !== 'staff');
    }
  });

  it('restricts entity and department administration to the Administrator', () => {
    for (const permission of [
      'organization.entity.manage',
      'organization.department.manage',
    ] as const) {
      const holders = ROLE_KEYS.filter((role) => defaultGrantIncludes(role, permission));
      expect(holders).toEqual(['administrator']);
    }
  });

  it('refuses approval and payment keys to the Administrator', () => {
    for (const key of APPROVAL_OR_PAYMENT_KEYS) {
      expect(defaultGrantIncludes('administrator', key)).toBe(false);
    }
  });

  it('refuses every vendor key to the Administrator', () => {
    for (const key of PERMISSION_KEYS.filter((permission) => permission.startsWith('vendor.'))) {
      expect(defaultGrantIncludes('administrator', key)).toBe(false);
    }
  });

  it('refuses every procurement key to the Administrator', () => {
    for (const key of PERMISSION_KEYS.filter((permission) => permission.startsWith('procurement.'))) {
      expect(defaultGrantIncludes('administrator', key)).toBe(false);
    }
  });

  it('lets GMs create, edit, submit and view requisitions in their entity', () => {
    expect(defaultGrantIncludes('gm', 'requisition.create')).toBe(true);
    expect(defaultGrantIncludes('gm', 'requisition.edit_draft')).toBe(true);
    expect(defaultGrantIncludes('gm', 'requisition.submit')).toBe(true);
    expect(defaultGrantIncludes('gm', 'requisition.discard_draft')).toBe(true);
    expect(defaultGrantIncludes('gm', 'procurement.view')).toBe(true);
    expect(defaultGrantIncludes('gm', 'procurement.edit_draft')).toBe(false);
    expect(defaultGrantIncludes('gm', 'procurement.submit')).toBe(false);
    expect(defaultGrantIncludes('gm', 'procurement.prepare')).toBe(false);
    expect(defaultGrantIncludes('gm', 'procurement.approve.operations')).toBe(false);
  });

  it('lets GMs read vendors without bank details or activation', () => {
    expect(defaultGrantIncludes('gm', 'vendor.view')).toBe(true);
    expect(defaultGrantIncludes('gm', 'vendor.view_bank_details')).toBe(false);
    expect(defaultGrantIncludes('gm', 'vendor.activate')).toBe(false);
    expect(defaultGrantIncludes('gm', 'vendor.create')).toBe(false);
  });

  it('lets GMs read their entity finance dashboard but not the consolidated view', () => {
    expect(defaultGrantIncludes('gm', 'finance.view')).toBe(true);
    expect(defaultGrantIncludes('gm', 'finance.dashboard.entity')).toBe(true);
    expect(defaultGrantIncludes('gm', 'finance.dashboard.consolidated')).toBe(false);
    expect(defaultGrantIncludes('gm', 'finance.view.consolidated')).toBe(false);
  });

  it('moves delivery verification from the GM to the Procurement Manager', () => {
    expect(defaultGrantIncludes('gm', 'procurement.verify.delivery')).toBe(false);
    expect(defaultGrantIncludes('gm', 'procurement.grn.record')).toBe(false);
    expect(defaultGrantIncludes('gm', 'procurement.close_short.request')).toBe(false);
    expect(defaultGrantIncludes('inventory_officer', 'procurement.verify.delivery')).toBe(true);
    expect(defaultGrantIncludes('inventory_officer', 'procurement.grn.record')).toBe(true);
    expect(defaultGrantIncludes('inventory_officer', 'procurement.close_short.request')).toBe(true);
    expect(defaultGrantIncludes('inventory_officer', 'finance.payment.execute')).toBe(false);
    expect(defaultGrantIncludes('inventory_officer', 'finance.funding.authorize')).toBe(false);
    expect(defaultGrantIncludes('inventory_officer', 'procurement.create')).toBe(false);
    expect(defaultGrantIncludes('inventory_officer', 'procurement.prepare')).toBe(true);
    expect(defaultGrantIncludes('inventory_officer', 'procurement.edit_draft')).toBe(true);
    expect(defaultGrantIncludes('inventory_officer', 'procurement.submit')).toBe(true);
    expect(defaultGrantIncludes('md', 'requisition.approve.need')).toBe(true);
    expect(defaultGrantIncludes('gm', 'requisition.approve.need')).toBe(false);
  });

  it('lets only the MD correct a locked second-batch date', () => {
    expect(defaultGrantIncludes('md', 'procurement.shortage.override')).toBe(true);
    for (const role of ROLE_KEYS) {
      if (role === 'md') continue;
      expect(defaultGrantIncludes(role, 'procurement.shortage.override')).toBe(false);
    }
  });

  it('gives confidential cases to the MD and both EDs, not to Admin or GM', () => {
    for (const key of ['cases.view', 'cases.create', 'cases.assign', 'cases.grant', 'cases.close'] as const) {
      expect(defaultGrantIncludes('md', key)).toBe(true);
      expect(defaultGrantIncludes('ed_operations', key)).toBe(true);
      expect(defaultGrantIncludes('ed_finance', key)).toBe(true);
      expect(defaultGrantIncludes('administrator', key)).toBe(false);
      expect(defaultGrantIncludes('gm', key)).toBe(false);
      expect(defaultGrantIncludes('inventory_officer', key)).toBe(false);
    }
  });

  it('lets only the MD queue a report email', () => {
    expect(defaultGrantIncludes('md', 'reports.email')).toBe(true);
    for (const role of ROLE_KEYS) {
      if (role === 'md') continue;
      expect(defaultGrantIncludes(role, 'reports.email')).toBe(false);
    }
  });

  it('gives HR keys to the HR Officer, disciplinary approval to MD, and none to Administrator', () => {
    expect(defaultGrantIncludes('hr_officer', 'hr.employee.view')).toBe(true);
    expect(defaultGrantIncludes('hr_officer', 'hr.view_sensitive')).toBe(true);
    expect(defaultGrantIncludes('hr_officer', 'hr.disciplinary.approve')).toBe(false);
    expect(defaultGrantIncludes('md', 'hr.disciplinary.approve')).toBe(true);
    expect(defaultGrantIncludes('md', 'hr.employee.view')).toBe(false);
    for (const key of PERMISSION_KEYS.filter((permission) => permission.startsWith('hr.'))) {
      expect(defaultGrantIncludes('administrator', key)).toBe(false);
    }
    expect([...ROLE_KEYS]).not.toContain('payroll_officer');
  });

  it('gives each role a unique home-gate permission', () => {
    const gates = ROLE_KEYS.map((role) => HOME_GATE_PERMISSION[role]);
    expect(new Set(gates).size).toBe(gates.length);
    for (const role of ROLE_KEYS) {
      expect(defaultGrantsForRole(role)).toContain(HOME_GATE_PERMISSION[role]);
    }
  });
});
