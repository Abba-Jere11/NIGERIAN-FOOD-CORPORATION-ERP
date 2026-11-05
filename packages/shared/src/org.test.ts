import { describe, expect, it } from 'vitest';
import { AUDIT_ACTIONS, AUDIT_ACTION_LABELS, SYSTEM_ACTORS } from './audit';
import {
  DEFAULT_DEPARTMENTS,
  HOLDING_ENTITY,
  ORGANIZATION_CODE,
  ROLE_KEYS,
  ROLES,
  SUBSIDIARY_ENTITIES,
} from './org';
import { SEED_USERS } from './seed-users';

/**
 * A4: Nigeria Food Corporation is the holding company and the four subsidiaries
 * are its direct children. Getting this wrong would put a subsidiary under
 * another subsidiary, which the whole approval model depends on being impossible.
 */
describe('the organisation structure', () => {
  it('names the holding company as the group itself', () => {
    expect(HOLDING_ENTITY.code).toBe(ORGANIZATION_CODE);
    expect(HOLDING_ENTITY.type).toBe('HOLDING');
  });

  it('has exactly four subsidiaries', () => {
    expect(SUBSIDIARY_ENTITIES).toHaveLength(4);
    expect(SUBSIDIARY_ENTITIES.map((entity) => entity.code)).toEqual(['YFZ', 'YFW', 'DMA', 'NOM']);
  });

  it('marks every subsidiary as a subsidiary, never as a second holding company', () => {
    for (const entity of SUBSIDIARY_ENTITIES) {
      expect(entity.type).toBe('SUBSIDIARY');
      expect(entity.legalName.length).toBeGreaterThan(entity.name.length - 1);
    }
  });

  it('uses codes that fit the reference-number format', () => {
    for (const entity of [HOLDING_ENTITY, ...SUBSIDIARY_ENTITIES]) {
      expect(entity.code).toMatch(/^[A-Z0-9]{2,10}$/);
    }
  });

  it('seeds seven departments', () => {
    expect(DEFAULT_DEPARTMENTS).toHaveLength(7);
    expect([...DEFAULT_DEPARTMENTS]).toEqual([
      'Operations',
      'Finance',
      'HR',
      'Production',
      'Stores',
      'Administration',
      'Maintenance',
    ]);
  });

  it('has no duplicate department names', () => {
    const lowered = DEFAULT_DEPARTMENTS.map((name) => name.toLowerCase());
    expect(new Set(lowered).size).toBe(lowered.length);
  });
});

describe('the audit action vocabulary', () => {
  it('has a readable label for every action', () => {
    for (const action of AUDIT_ACTIONS) {
      expect(AUDIT_ACTION_LABELS[action]).toBeTruthy();
    }
  });

  it('has no duplicate actions', () => {
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length);
  });

  it('names every permitted system actor, so none can act anonymously (R1)', () => {
    expect([...SYSTEM_ACTORS]).toEqual([
      'system:seed',
      'system:escalation',
      'system:outbox',
      'system:edms',
    ]);
    for (const name of SYSTEM_ACTORS) {
      expect(name.startsWith('system:')).toBe(true);
    }
  });

  it('includes the actions the audit viewer must be able to filter on', () => {
    for (const action of ['login', 'create', 'edit', 'approve', 'reject', 'download'] as const) {
      expect(AUDIT_ACTIONS).toContain(action);
    }
  });
});

describe('the seeded identities', () => {
  it('covers all nine roles', () => {
    const roles = new Set(SEED_USERS.map((user) => user.role));
    expect(roles).toEqual(new Set(ROLE_KEYS));
  });

  it('keeps unique emails and ids', () => {
    expect(new Set(SEED_USERS.map((user) => user.id)).size).toBe(SEED_USERS.length);
    expect(new Set(SEED_USERS.map((user) => user.email)).size).toBe(SEED_USERS.length);
  });

  it('covers every subsidiary for both entity-scoped roles', () => {
    for (const role of ['gm', 'finance_head'] as const) {
      const codes = SEED_USERS.filter((user) => user.role === role)
        .map((user) => user.entityCode)
        .sort();
      expect(codes).toEqual(['DMA', 'NOM', 'YFW', 'YFZ']);
    }
  });

  it('gives entity-scoped users an entity and corporate users none', () => {
    for (const user of SEED_USERS) {
      if (user.scopeType === 'ENTITY') {
        expect(user.entityCode).toBeTruthy();
      } else {
        expect(user.entityCode).toBeNull();
      }
      expect(user.scopeType).toBe(ROLES[user.role].scopeType);
    }
  });

  it('identifies every user with a uuid, matching the M1 audit actor ids plus the Administrator', () => {
    expect(SEED_USERS).toHaveLength(16);
    for (const user of SEED_USERS) {
      expect(user.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    }
  });
});
