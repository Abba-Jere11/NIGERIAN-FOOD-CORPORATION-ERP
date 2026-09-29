import { describe, expect, it } from 'vitest';
import { AUDIT_VIEWER_ROLES, ROLE_KEYS, ROLES } from './org';
import {
  PERMISSION_KEYS,
  ROLE_PERMISSIONS,
  permissionsForRole,
  roleHasPermission,
} from './permissions';

/**
 * A5: the system has exactly five roles, and no others exist in any module.
 * These tests pin that down so a sixth role cannot arrive quietly in a later
 * milestone.
 */
describe('the five-role model', () => {
  it('has exactly five roles', () => {
    expect(ROLE_KEYS).toHaveLength(5);
    expect([...ROLE_KEYS]).toEqual(['gm', 'ed_operations', 'md', 'ed_finance', 'finance_head']);
  });

  it('defines every role, with a scope', () => {
    for (const key of ROLE_KEYS) {
      const role = ROLES[key];
      expect(role.key).toBe(key);
      expect(role.name.length).toBeGreaterThan(0);
      expect(role.shortName.length).toBeGreaterThan(0);
      expect(['CORPORATE', 'ENTITY']).toContain(role.scopeType);
    }
  });

  it('scopes the GM and the Finance Head to a single subsidiary', () => {
    expect(ROLES.gm.scopeType).toBe('ENTITY');
    expect(ROLES.finance_head.scopeType).toBe('ENTITY');
  });

  it('gives the three executive roles group-wide scope', () => {
    expect(ROLES.md.scopeType).toBe('CORPORATE');
    expect(ROLES.ed_finance.scopeType).toBe('CORPORATE');
    expect(ROLES.ed_operations.scopeType).toBe('CORPORATE');
  });
});

describe('the permission map', () => {
  it('grants every permission to somebody, so none is dead weight', () => {
    for (const permission of PERMISSION_KEYS) {
      const holders = ROLE_KEYS.filter((role) => roleHasPermission(role, permission));
      expect(holders.length, `nobody holds ${permission}`).toBeGreaterThan(0);
    }
  });

  it('grants no permission that is not declared', () => {
    for (const role of ROLE_KEYS) {
      for (const permission of ROLE_PERMISSIONS[role]) {
        expect(PERMISSION_KEYS).toContain(permission);
      }
    }
  });

  it('gives the MD system administration, per A5', () => {
    expect([...permissionsForRole('md')]).toEqual([...PERMISSION_KEYS]);
  });

  it('restricts the audit log to the MD and ED Finance (M1 item 7)', () => {
    const viewers = ROLE_KEYS.filter((role) => roleHasPermission(role, 'audit.view'));
    expect(viewers.sort()).toEqual([...AUDIT_VIEWER_ROLES].sort());
  });

  it('lets every role see the organisation it belongs to', () => {
    for (const role of ROLE_KEYS) {
      expect(roleHasPermission(role, 'organization.view')).toBe(true);
    }
  });

  it('restricts entity and department administration to the MD', () => {
    for (const permission of [
      'organization.entity.manage',
      'organization.department.manage',
    ] as const) {
      const holders = ROLE_KEYS.filter((role) => roleHasPermission(role, permission));
      expect(holders).toEqual(['md']);
    }
  });
});
