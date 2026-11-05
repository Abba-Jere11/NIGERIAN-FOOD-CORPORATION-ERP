import type { ActorContext } from '@nfc/db';
import { DEFAULT_ROLE_GRANTS, ROLE_KEYS, type RoleKey } from '@nfc/shared';
import { describe, expect, it } from 'vitest';
import { ForbiddenError } from '../common/errors/domain-error';
import { assertCan, can, scopeFilter } from './can';

function actor(overrides: Partial<ActorContext> & { grants?: RoleKey } = {}): ActorContext {
  const { grants, ...rest } = overrides;
  const permissions = rest.permissions ?? (grants ? [...DEFAULT_ROLE_GRANTS[grants]] : []);
  return {
    ref: '00000000-0000-4000-8000-000000000001',
    name: 'Test Actor',
    role: grants ?? 'md',
    scopeType: 'CORPORATE',
    entityIds: [],
    isCorporate: true,
    isAdmin: grants === 'administrator',
    permissions,
    homePath: '/home/md',
    ...rest,
  };
}

const YFZ = '11111111-1111-4111-8111-111111111111';
const DMA = '22222222-2222-4222-8222-222222222222';

describe('can()', () => {
  it('denies when there is no actor', () => {
    expect(can(null, 'organization.view')).toBe(false);
    expect(can(undefined, 'organization.view')).toBe(false);
  });

  it('denies a system actor, which never serves a request', () => {
    expect(can(actor({ ref: 'system:seed', permissions: ['organization.view'] }), 'organization.view')).toBe(
      false,
    );
  });

  it('denies by default when the permission is not in the grant list', () => {
    expect(can(actor({ permissions: ['organization.view'], isAdmin: false }), 'audit.view')).toBe(false);
    expect(can(actor({ permissions: [] }), 'organization.view')).toBe(false);
  });

  it('lets the Administrator manage the organisation, not the audit log', () => {
    const admin = actor({ grants: 'administrator', isCorporate: false, entityIds: [] });
    expect(can(admin, 'organization.view')).toBe(true);
    expect(can(admin, 'organization.entity.manage')).toBe(true);
    expect(can(admin, 'organization.department.manage')).toBe(true);
    expect(can(admin, 'admin.user.manage')).toBe(true);
    expect(can(admin, 'audit.view')).toBe(false);
    expect(can(admin, 'audit.export')).toBe(false);
    expect(can(admin, 'finance.payment.execute')).toBe(false);
  });

  it('gives the MD the audit log but not organisation administration', () => {
    const md = actor({ grants: 'md' });
    expect(can(md, 'audit.view')).toBe(true);
    expect(can(md, 'audit.export')).toBe(true);
    expect(can(md, 'organization.view')).toBe(true);
    expect(can(md, 'organization.entity.manage')).toBe(false);
    expect(can(md, 'organization.department.manage')).toBe(false);
    expect(can(md, 'admin.user.manage')).toBe(false);
  });

  it('gives ED Finance the audit log but not organisation administration', () => {
    const edFinance = actor({ grants: 'ed_finance' });
    expect(can(edFinance, 'audit.view')).toBe(true);
    expect(can(edFinance, 'audit.export')).toBe(true);
    expect(can(edFinance, 'organization.view')).toBe(true);
    expect(can(edFinance, 'organization.entity.manage')).toBe(false);
  });

  it.each<RoleKey>(['gm', 'ed_operations', 'finance_head', 'administrator', 'inventory_officer'])(
    'refuses the audit log to %s',
    (grants) => {
      expect(can(actor({ grants }), 'audit.view')).toBe(false);
      expect(can(actor({ grants }), 'audit.export')).toBe(false);
    },
  );

  it.each<RoleKey>(['gm', 'ed_operations', 'ed_finance', 'md', 'finance_head', 'inventory_officer'])(
    'refuses entity administration to %s',
    (grants) => {
      expect(can(actor({ grants }), 'organization.entity.manage')).toBe(false);
    },
  );

  it('lets an entity-scoped role reach only its own subsidiary', () => {
    const gm = actor({
      grants: 'gm',
      scopeType: 'ENTITY',
      isCorporate: false,
      entityIds: [YFZ],
    });

    expect(can(gm, 'organization.view', YFZ)).toBe(true);
    expect(can(gm, 'organization.view', DMA)).toBe(false);
  });

  it('lets a corporate business role reach every subsidiary without listing them', () => {
    const md = actor({ grants: 'md', isCorporate: true, entityIds: [] });
    expect(can(md, 'organization.view', YFZ)).toBe(true);
    expect(can(md, 'organization.view', DMA)).toBe(true);
  });

  it('lets the Procurement Manager verify delivery and refuses it to the GM', () => {
    const officer = actor({ grants: 'inventory_officer', isCorporate: true, entityIds: [] });
    const gm = actor({ grants: 'gm', scopeType: 'ENTITY', isCorporate: false, entityIds: [YFZ] });
    expect(can(officer, 'procurement.verify.delivery', YFZ)).toBe(true);
    expect(can(officer, 'procurement.grn.record', YFZ)).toBe(true);
    expect(can(officer, 'procurement.close_short.request', YFZ)).toBe(true);
    expect(can(gm, 'procurement.verify.delivery', YFZ)).toBe(false);
    expect(can(gm, 'procurement.grn.record', YFZ)).toBe(false);
    expect(can(gm, 'procurement.close_short.request', YFZ)).toBe(false);
  });

  it('does not let the Administrator see another subsidiary’s audit rows via the admin flag', () => {
    const admin = actor({
      grants: 'administrator',
      isCorporate: false,
      isAdmin: true,
      entityIds: [],
    });
    expect(can(admin, 'audit.view', YFZ)).toBe(false);
  });

  it('lets the Administrator manage any entity without becoming corporate', () => {
    const admin = actor({
      grants: 'administrator',
      isCorporate: false,
      isAdmin: true,
      entityIds: [],
    });
    expect(can(admin, 'organization.entity.manage', YFZ)).toBe(true);
  });

  it('lets authorised business users create official reports and refuses MD powers to others', () => {
    const gm = actor({ grants: 'gm', isCorporate: false, entityIds: [YFZ] });
    const md = actor({ grants: 'md' });
    const admin = actor({
      grants: 'administrator',
      isCorporate: false,
      isAdmin: true,
      entityIds: [],
    });
    const edOps = actor({ grants: 'ed_operations' });
    expect(can(gm, 'org_report.create', YFZ)).toBe(true);
    expect(can(gm, 'org_report.submit', YFZ)).toBe(true);
    expect(can(gm, 'org_report.forward', YFZ)).toBe(false);
    expect(can(gm, 'org_report.minute.issue', YFZ)).toBe(false);
    expect(can(edOps, 'org_report.minute.issue')).toBe(false);
    expect(can(md, 'org_report.forward')).toBe(true);
    expect(can(md, 'org_report.minute.issue')).toBe(true);
    expect(can(md, 'org_report.decide')).toBe(true);
    expect(can(admin, 'org_report.create')).toBe(false);
    expect(can(admin, 'org_report.view')).toBe(false);
    expect(can(admin, 'org_report.minute.issue')).toBe(false);
    expect(can(admin, 'org_report.decide')).toBe(false);
    expect(can(admin, 'org_report.email')).toBe(false);
    expect(can(admin, 'org_report.template.manage')).toBe(true);
  });

  it('does not invent an HOD role or HOD permission', () => {
    expect([...ROLE_KEYS]).not.toContain('hod');
    expect(can(actor({ grants: 'gm' }), 'org_report.create')).toBe(true);
  });

  it('lets the Administrator enter the Document Portal without viewing business files', () => {
    const admin = actor({
      grants: 'administrator',
      isCorporate: false,
      isAdmin: true,
      entityIds: [],
    });
    expect(can(admin, 'edms.portal.access')).toBe(true);
    expect(can(admin, 'edms.manage_categories')).toBe(true);
    expect(can(admin, 'edms.manage_retention', YFZ)).toBe(true);
    expect(can(admin, 'edms.view')).toBe(false);
    expect(can(admin, 'edms.view', YFZ)).toBe(false);
    expect(can(admin, 'edms.upload', YFZ)).toBe(false);
  });

  it('lets the HR Officer reach every subsidiary and refuses HR keys to Admin and GM', () => {
    const hr = actor({ grants: 'hr_officer', isCorporate: true, entityIds: [] });
    const gm = actor({ grants: 'gm', scopeType: 'ENTITY', isCorporate: false, entityIds: [YFZ] });
    const admin = actor({
      grants: 'administrator',
      isCorporate: false,
      isAdmin: true,
      entityIds: [],
    });
    expect(can(hr, 'hr.employee.view', YFZ)).toBe(true);
    expect(can(hr, 'hr.employee.view', DMA)).toBe(true);
    expect(can(hr, 'hr.view_sensitive', YFZ)).toBe(true);
    expect(can(hr, 'hr.disciplinary.approve')).toBe(false);
    expect(can(gm, 'hr.employee.view', YFZ)).toBe(false);
    expect(can(admin, 'hr.employee.view', YFZ)).toBe(false);
    expect(can(admin, 'hr.view_sensitive')).toBe(false);
    expect(can(actor({ grants: 'md' }), 'hr.disciplinary.approve')).toBe(true);
    expect(can(actor({ grants: 'md' }), 'hr.employee.view')).toBe(false);
  });

  it('lets HR prepare payroll, Finance Head approve and pay, and ED Finance approve above threshold — never Admin or GM', () => {
    const hr = actor({ grants: 'hr_officer', isCorporate: true, entityIds: [] });
    const fh = actor({
      grants: 'finance_head',
      scopeType: 'ENTITY',
      isCorporate: false,
      entityIds: [YFZ],
    });
    const edf = actor({ grants: 'ed_finance', isCorporate: true, entityIds: [] });
    const gm = actor({ grants: 'gm', scopeType: 'ENTITY', isCorporate: false, entityIds: [YFZ] });
    const admin = actor({
      grants: 'administrator',
      isCorporate: false,
      isAdmin: true,
      entityIds: [],
    });
    const md = actor({ grants: 'md', isCorporate: true, entityIds: [] });
    expect(can(hr, 'payroll.run.prepare', YFZ)).toBe(true);
    expect(can(hr, 'payroll.structure.manage', YFZ)).toBe(true);
    expect(can(hr, 'payroll.config')).toBe(true);
    expect(can(hr, 'payroll.view', YFZ)).toBe(true);
    expect(can(hr, 'payroll.run.approve', YFZ)).toBe(false);
    expect(can(hr, 'org_report.create', YFZ)).toBe(true);
    expect(can(fh, 'payroll.run.approve', YFZ)).toBe(true);
    expect(can(fh, 'payroll.pay', YFZ)).toBe(true);
    expect(can(fh, 'payroll.run.prepare', YFZ)).toBe(false);
    expect(can(edf, 'payroll.run.approve', YFZ)).toBe(true);
    expect(can(edf, 'payroll.view', YFZ)).toBe(true);
    expect(can(edf, 'payroll.pay', YFZ)).toBe(false);
    expect(can(gm, 'payroll.view', YFZ)).toBe(false);
    expect(can(admin, 'payroll.view', YFZ)).toBe(false);
    expect(can(md, 'payroll.view')).toBe(false);
    expect(can(actor({ grants: 'inventory_officer', isCorporate: true, entityIds: [] }), 'payroll.view')).toBe(
      false,
    );
  });

  it('refuses the Document Portal to GM, Finance Head and Procurement Manager', () => {
    const gm = actor({ grants: 'gm', isCorporate: false, entityIds: [YFZ] });
    const financeHead = actor({ grants: 'finance_head', isCorporate: false, entityIds: [YFZ] });
    const officer = actor({ grants: 'inventory_officer', isCorporate: true, entityIds: [] });
    expect(can(gm, 'edms.portal.access')).toBe(false);
    expect(can(financeHead, 'edms.portal.access')).toBe(false);
    expect(can(officer, 'edms.portal.access')).toBe(false);
  });

  it('ignores the entity check when no entity is named', () => {
    const financeHead = actor({
      grants: 'finance_head',
      scopeType: 'ENTITY',
      isCorporate: false,
      entityIds: [YFZ],
    });
    expect(can(financeHead, 'organization.view')).toBe(true);
  });
});

describe('assertCan()', () => {
  it('says the permission is the problem when the grant is missing', () => {
    expect(() => assertCan(actor({ grants: 'gm' }), 'audit.view')).toThrow(ForbiddenError);
    expect(() => assertCan(actor({ grants: 'gm' }), 'audit.view')).toThrow(/role does not permit/i);
  });

  it('says the subsidiary is the problem when the subsidiary is the problem', () => {
    const gm = actor({ grants: 'gm', isCorporate: false, entityIds: [YFZ] });
    expect(() => assertCan(gm, 'organization.view', DMA)).toThrow(/access to this subsidiary/i);
  });

  it('says you are not signed in when there is no actor', () => {
    expect(() => assertCan(null, 'organization.view')).toThrow(/not signed in/i);
  });

  it('returns quietly when the action is permitted', () => {
    expect(() => assertCan(actor({ grants: 'md' }), 'audit.export')).not.toThrow();
  });
});

describe('scopeFilter()', () => {
  it('returns null for a corporate actor, meaning every entity', () => {
    expect(scopeFilter(actor({ isCorporate: true }))).toBeNull();
  });

  it('returns the actor entities for an entity-scoped actor', () => {
    expect(scopeFilter(actor({ grants: 'gm', isCorporate: false, entityIds: [YFZ] }))).toEqual([YFZ]);
  });
});

