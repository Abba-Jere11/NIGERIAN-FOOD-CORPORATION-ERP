import type { ActorContext } from '@nfc/db';
import type { RoleKey } from '@nfc/shared';
import { describe, expect, it } from 'vitest';
import { ForbiddenError } from '../common/errors/domain-error';
import { assertCan, can, scopeFilter } from './can';

/**
 * Rule R4: permissions are enforced on the server, and denied by default.
 *
 * These tests state the M1 access model as facts. When M2 moves the lookup from
 * the static role map to database-backed grants, these tests must still pass
 * unchanged - that is how we will know the move did not quietly widen access.
 */
function actor(overrides: Partial<ActorContext> = {}): ActorContext {
  return {
    ref: '00000000-0000-4000-8000-000000000001',
    name: 'Test Actor',
    role: 'md',
    scopeType: 'CORPORATE',
    entityIds: [],
    isCorporate: true,
    ...overrides,
  };
}

const YFZ = '11111111-1111-4111-8111-111111111111';
const DMA = '22222222-2222-4222-8222-222222222222';

describe('can()', () => {
  it('denies when there is no actor', () => {
    expect(can(null, 'organization.view')).toBe(false);
    expect(can(undefined, 'organization.view')).toBe(false);
  });

  it('denies a system actor, which has no role and never serves a request', () => {
    expect(can(actor({ role: null }), 'organization.view')).toBe(false);
  });

  it('lets the MD administer the organisation', () => {
    const md = actor({ role: 'md' });
    expect(can(md, 'organization.view')).toBe(true);
    expect(can(md, 'organization.entity.manage')).toBe(true);
    expect(can(md, 'organization.department.manage')).toBe(true);
    expect(can(md, 'audit.view')).toBe(true);
    expect(can(md, 'audit.export')).toBe(true);
  });

  it('gives ED Finance the audit log but not organisation administration', () => {
    const edFinance = actor({ role: 'ed_finance' });
    expect(can(edFinance, 'audit.view')).toBe(true);
    expect(can(edFinance, 'audit.export')).toBe(true);
    expect(can(edFinance, 'organization.view')).toBe(true);
    expect(can(edFinance, 'organization.entity.manage')).toBe(false);
    expect(can(edFinance, 'organization.department.manage')).toBe(false);
  });

  it.each<RoleKey>(['gm', 'ed_operations', 'finance_head'])(
    'refuses the audit log to %s',
    (role) => {
      expect(can(actor({ role }), 'audit.view')).toBe(false);
      expect(can(actor({ role }), 'audit.export')).toBe(false);
    },
  );

  it.each<RoleKey>(['gm', 'ed_operations', 'ed_finance', 'finance_head'])(
    'refuses entity administration to %s',
    (role) => {
      expect(can(actor({ role }), 'organization.entity.manage')).toBe(false);
    },
  );

  it('lets an entity-scoped role reach only its own subsidiary', () => {
    const gm = actor({
      role: 'gm',
      scopeType: 'ENTITY',
      isCorporate: false,
      entityIds: [YFZ],
    });

    expect(can(gm, 'organization.view', YFZ)).toBe(true);
    expect(can(gm, 'organization.view', DMA)).toBe(false);
  });

  it('lets a corporate role reach every subsidiary without listing them', () => {
    const md = actor({ role: 'md', isCorporate: true, entityIds: [] });
    expect(can(md, 'organization.view', YFZ)).toBe(true);
    expect(can(md, 'organization.view', DMA)).toBe(true);
  });

  it('ignores the entity check when no entity is named', () => {
    const financeHead = actor({
      role: 'finance_head',
      scopeType: 'ENTITY',
      isCorporate: false,
      entityIds: [YFZ],
    });
    expect(can(financeHead, 'organization.view')).toBe(true);
  });
});

describe('assertCan()', () => {
  it('says the role is the problem when the role is the problem', () => {
    expect(() => assertCan(actor({ role: 'gm' }), 'audit.view')).toThrow(ForbiddenError);
    expect(() => assertCan(actor({ role: 'gm' }), 'audit.view')).toThrow(
      /role does not permit/i,
    );
  });

  it('says the subsidiary is the problem when the subsidiary is the problem', () => {
    const gm = actor({ role: 'gm', isCorporate: false, entityIds: [YFZ] });
    expect(() => assertCan(gm, 'organization.view', DMA)).toThrow(/access to this subsidiary/i);
  });

  it('says you are not signed in when there is no actor', () => {
    expect(() => assertCan(null, 'organization.view')).toThrow(/not signed in/i);
  });

  it('returns quietly when the action is permitted', () => {
    expect(() => assertCan(actor({ role: 'md' }), 'audit.export')).not.toThrow();
  });
});

describe('scopeFilter()', () => {
  it('returns null for a corporate actor, meaning every entity', () => {
    expect(scopeFilter(actor({ isCorporate: true }))).toBeNull();
  });

  it('returns the actor entities for an entity-scoped actor', () => {
    expect(scopeFilter(actor({ isCorporate: false, entityIds: [YFZ] }))).toEqual([YFZ]);
  });
});
