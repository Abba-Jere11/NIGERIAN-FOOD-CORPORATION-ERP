import { type RoleKey, type ScopeType } from './org';

/**
 * The sixteen seeded identities. The first eleven keep the UUIDs M1 wrote to
 * `audit_log.actor_user_id` so history stays continuous; then Administrator,
 * Procurement Manager, the group-wide HR Officer, and the staff logins.
 */

export interface SeedUser {
  id: string;
  email: string;
  name: string;
  position: string;
  role: RoleKey;
  scopeType: ScopeType;
  /** Entity code for entity-scoped roles; null for corporate roles. */
  entityCode: string | null;
  /** Department name within that entity, when the login should sit in one. */
  departmentName?: string;
}

export const SEED_USERS: readonly SeedUser[] = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'md@nfc.local',
    name: 'Dr. Babagana Adam',
    position: 'Managing Director',
    role: 'md',
    scopeType: 'CORPORATE',
    entityCode: null,
  },
  {
    id: '00000000-0000-4000-8000-000000000002',
    email: 'ed.operations@nfc.local',
    name: 'Umar Tor',
    position: 'Executive Director, Operations',
    role: 'ed_operations',
    scopeType: 'CORPORATE',
    entityCode: null,
  },
  {
    id: '00000000-0000-4000-8000-000000000003',
    email: 'ed.finance@nfc.local',
    name: 'Muhammad Jere',
    position: 'Executive Director, Finance',
    role: 'ed_finance',
    scopeType: 'CORPORATE',
    entityCode: null,
  },
  {
    id: '00000000-0000-4000-8000-000000000011',
    email: 'gm.yfz@nfc.local',
    name: 'Musa Gwary',
    position: 'General Manager, Yobe Fertilizer',
    role: 'gm',
    scopeType: 'ENTITY',
    entityCode: 'YFZ',
  },
  {
    id: '00000000-0000-4000-8000-000000000012',
    email: 'gm.yfw@nfc.local',
    name: 'Fatima Sani Lawal',
    position: 'General Manager, Yobe Flour & Wheat Mills',
    role: 'gm',
    scopeType: 'ENTITY',
    entityCode: 'YFW',
  },
  {
    id: '00000000-0000-4000-8000-000000000013',
    email: 'gm.dma@nfc.local',
    name: 'Ibrahim Kachalla Modu',
    position: 'General Manager, Damaturu Modern Abattoir',
    role: 'gm',
    scopeType: 'ENTITY',
    entityCode: 'DMA',
  },
  {
    id: '00000000-0000-4000-8000-000000000014',
    email: 'gm.nom@nfc.local',
    name: 'Aisha Mohammed Kyari',
    position: 'General Manager, Nguru Oil Mills',
    role: 'gm',
    scopeType: 'ENTITY',
    entityCode: 'NOM',
  },
  {
    id: '00000000-0000-4000-8000-000000000021',
    email: 'fh.yfz@nfc.local',
    name: 'Yahuza Yahuza',
    position: 'Finance Head, Yobe Fertilizer',
    role: 'finance_head',
    scopeType: 'ENTITY',
    entityCode: 'YFZ',
  },
  {
    id: '00000000-0000-4000-8000-000000000022',
    email: 'fh.yfw@nfc.local',
    name: 'Yakubu Tijjani Usman',
    position: 'Finance Head, Yobe Flour & Wheat Mills',
    role: 'finance_head',
    scopeType: 'ENTITY',
    entityCode: 'YFW',
  },
  {
    id: '00000000-0000-4000-8000-000000000023',
    email: 'fh.dma@nfc.local',
    name: 'Zainab Abdullahi Waziri',
    position: 'Finance Head, Damaturu Modern Abattoir',
    role: 'finance_head',
    scopeType: 'ENTITY',
    entityCode: 'DMA',
  },
  {
    id: '00000000-0000-4000-8000-000000000024',
    email: 'fh.nom@nfc.local',
    name: 'Samuel Terkimbi Akaa',
    position: 'Finance Head, Nguru Oil Mills',
    role: 'finance_head',
    scopeType: 'ENTITY',
    entityCode: 'NOM',
  },
  {
    id: '00000000-0000-4000-8000-000000000004',
    email: 'inventory@nfc.local',
    name: 'Hauwa Goni',
    position: 'Procurement Manager',
    role: 'inventory_officer',
    scopeType: 'CORPORATE',
    entityCode: null,
  },
  {
    id: '00000000-0000-4000-8000-000000000030',
    email: 'administrator@nfc.local',
    name: 'Chinedu Okonkwo',
    position: 'Administrator',
    role: 'administrator',
    scopeType: 'CORPORATE',
    entityCode: null,
  },
  {
    id: '00000000-0000-4000-8000-000000000040',
    email: 'hr@nfc.local',
    name: 'Amina Bukar',
    position: 'HR Officer',
    role: 'hr_officer',
    scopeType: 'CORPORATE',
    entityCode: null,
  },
  {
    id: '00000000-0000-4000-8000-000000000041',
    email: 'staff.yfz@nfc.local',
    name: 'Ibrahim Staff',
    position: 'Staff, Yobe Fertilizer',
    role: 'staff',
    scopeType: 'ENTITY',
    entityCode: 'YFZ',
  },
  {
    id: '00000000-0000-4000-8000-000000000042',
    email: 'staff.yfw@nfc.local',
    name: 'Maryam Abubakar',
    position: 'Staff, Yobe Flour & Wheat Mills',
    role: 'staff',
    scopeType: 'ENTITY',
    entityCode: 'YFW',
    departmentName: 'Administration',
  },
];

export const ADMINISTRATOR_USER_ID = '00000000-0000-4000-8000-000000000030';

/** Documented TOTP secret used only when seeding the test database. */
export const TOTP_FIXTURE_SECRET = 'JBSWY3DPEHPK3PXP';

export function seedUserByEmail(email: string): SeedUser | undefined {
  const lowered = email.trim().toLowerCase();
  return SEED_USERS.find((user) => user.email === lowered);
}

export function seedUserById(id: string): SeedUser | undefined {
  return SEED_USERS.find((user) => user.id === id);
}
