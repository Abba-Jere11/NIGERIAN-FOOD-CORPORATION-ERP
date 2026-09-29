import { type RoleKey, type ScopeType } from './org';

/**
 * The dev-actor registry: M1's bridge until M2 delivers real identity.
 *
 * M1 deliberately contains no users, authentication or roles (they are listed
 * under "Not in this milestone"), yet the milestone still asks for MD-only
 * administration screens and an audit viewer restricted to the MD and ED
 * Finance. Rather than fake those restrictions in the interface, the API
 * resolves an acting identity from this fixed registry, enforces the role and
 * scope rules against it server-side, and records it in the audit log.
 *
 * The identifiers are intentionally synthetic and obviously non-random so that
 * nobody mistakes them for production accounts. M2 replaces this entire file
 * with the `users` table, sessions and the `can()` permission engine, and will
 * seed real users carrying these same identifiers so audit history stays
 * continuous.
 */

export interface DevActor {
  /** Value supplied in the `x-dev-actor` header, e.g. `gm.yfz`. */
  key: string;
  /** Stable uuid written to `audit_log.actor_user_id`. */
  userId: string;
  name: string;
  position: string;
  role: RoleKey;
  scopeType: ScopeType;
  /** Entity code for entity-scoped roles; null for corporate roles. */
  entityCode: string | null;
}

export const DEV_ACTORS: readonly DevActor[] = [
  {
    key: 'md',
    userId: '00000000-0000-4000-8000-000000000001',
    name: 'Abubakar Sadiq Ibrahim',
    position: 'Managing Director',
    role: 'md',
    scopeType: 'CORPORATE',
    entityCode: null,
  },
  {
    key: 'ed.operations',
    userId: '00000000-0000-4000-8000-000000000002',
    name: 'Halima Yusuf Bello',
    position: 'Executive Director, Operations',
    role: 'ed_operations',
    scopeType: 'CORPORATE',
    entityCode: null,
  },
  {
    key: 'ed.finance',
    userId: '00000000-0000-4000-8000-000000000003',
    name: 'Emeka Chukwuma Obi',
    position: 'Executive Director, Finance',
    role: 'ed_finance',
    scopeType: 'CORPORATE',
    entityCode: null,
  },

  {
    key: 'gm.yfz',
    userId: '00000000-0000-4000-8000-000000000011',
    name: 'Musa Adamu Garba',
    position: 'General Manager, Yobe Fertilizer',
    role: 'gm',
    scopeType: 'ENTITY',
    entityCode: 'YFZ',
  },
  {
    key: 'gm.yfw',
    userId: '00000000-0000-4000-8000-000000000012',
    name: 'Fatima Sani Lawal',
    position: 'General Manager, Yobe Flour & Wheat Mills',
    role: 'gm',
    scopeType: 'ENTITY',
    entityCode: 'YFW',
  },
  {
    key: 'gm.dma',
    userId: '00000000-0000-4000-8000-000000000013',
    name: 'Ibrahim Kachalla Modu',
    position: 'General Manager, Damaturu Modern Abattoir',
    role: 'gm',
    scopeType: 'ENTITY',
    entityCode: 'DMA',
  },
  {
    key: 'gm.nom',
    userId: '00000000-0000-4000-8000-000000000014',
    name: 'Aisha Mohammed Kyari',
    position: 'General Manager, Nguru Oil Mills',
    role: 'gm',
    scopeType: 'ENTITY',
    entityCode: 'NOM',
  },

  {
    key: 'fh.yfz',
    userId: '00000000-0000-4000-8000-000000000021',
    name: 'Grace Oluwaseun Adeyemi',
    position: 'Finance Head, Yobe Fertilizer',
    role: 'finance_head',
    scopeType: 'ENTITY',
    entityCode: 'YFZ',
  },
  {
    key: 'fh.yfw',
    userId: '00000000-0000-4000-8000-000000000022',
    name: 'Yakubu Tijjani Usman',
    position: 'Finance Head, Yobe Flour & Wheat Mills',
    role: 'finance_head',
    scopeType: 'ENTITY',
    entityCode: 'YFW',
  },
  {
    key: 'fh.dma',
    userId: '00000000-0000-4000-8000-000000000023',
    name: 'Zainab Abdullahi Waziri',
    position: 'Finance Head, Damaturu Modern Abattoir',
    role: 'finance_head',
    scopeType: 'ENTITY',
    entityCode: 'DMA',
  },
  {
    key: 'fh.nom',
    userId: '00000000-0000-4000-8000-000000000024',
    name: 'Samuel Terkimbi Akaa',
    position: 'Finance Head, Nguru Oil Mills',
    role: 'finance_head',
    scopeType: 'ENTITY',
    entityCode: 'NOM',
  },
];

export const DEFAULT_DEV_ACTOR_KEY = 'md';

export function findDevActor(key: string): DevActor | undefined {
  return DEV_ACTORS.find((actor) => actor.key === key);
}

export function devActorKeys(): string[] {
  return DEV_ACTORS.map((actor) => actor.key);
}
