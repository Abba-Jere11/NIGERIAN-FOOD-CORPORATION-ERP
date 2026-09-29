import { describe, expect, it } from 'vitest';
import { AUDIT_ACTIONS, AUDIT_ACTION_LABELS, SYSTEM_ACTORS } from './audit';
import { DEV_ACTORS, DEFAULT_DEV_ACTOR_KEY, devActorKeys } from './dev-actors';
import {
  DEFAULT_DEPARTMENTS,
  HOLDING_ENTITY,
  ORGANIZATION_CODE,
  ROLES,
  SUBSIDIARY_ENTITIES,
} from './org';

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
    expect([...SYSTEM_ACTORS]).toEqual(['system:seed', 'system:escalation', 'system:outbox']);
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

/**
 * The dev-actor registry is M1's declared bridge in place of authentication. It
 * is deleted in M2, but while it exists it must cover every role and subsidiary,
 * or the role rules cannot be exercised at all.
 */
describe('the development actor registry', () => {
  it('has a default actor that exists', () => {
    expect(devActorKeys()).toContain(DEFAULT_DEV_ACTOR_KEY);
  });

  it('has unique keys', () => {
    const keys = devActorKeys();
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('covers all five roles', () => {
    const roles = new Set(DEV_ACTORS.map((actor) => actor.role));
    expect(roles).toEqual(new Set(Object.keys(ROLES)));
  });

  it('covers every subsidiary for both entity-scoped roles', () => {
    for (const role of ['gm', 'finance_head'] as const) {
      const codes = DEV_ACTORS.filter((actor) => actor.role === role)
        .map((actor) => actor.entityCode)
        .sort();
      expect(codes).toEqual(['DMA', 'NOM', 'YFW', 'YFZ']);
    }
  });

  it('gives entity-scoped actors an entity and corporate actors none', () => {
    for (const actor of DEV_ACTORS) {
      if (actor.scopeType === 'ENTITY') {
        expect(actor.entityCode).toBeTruthy();
      } else {
        expect(actor.entityCode).toBeNull();
      }
      expect(actor.scopeType).toBe(ROLES[actor.role].scopeType);
    }
  });

  it('identifies every actor with a uuid, so audit rows look the way M2 will write them', () => {
    for (const actor of DEV_ACTORS) {
      expect(actor.userId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    }
  });
});
