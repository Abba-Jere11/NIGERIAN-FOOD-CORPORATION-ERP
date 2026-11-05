import type { PermissionKey } from './permissions';

export const VENDOR_STATUSES = [
  'DRAFT',
  'PENDING_REVIEW',
  'ACTIVE',
  'PENDING_REVERIFICATION',
  'SUSPENDED',
  'BLACKLISTED',
] as const;

export type VendorStatus = (typeof VENDOR_STATUSES)[number];

export function isVendorStatus(value: string): value is VendorStatus {
  return (VENDOR_STATUSES as readonly string[]).includes(value);
}

/** Statuses that may appear in procurement vendor selection. */
export const VENDOR_SELECTABLE_STATUSES: readonly VendorStatus[] = ['ACTIVE'];

export const VENDOR_COMPLIANCE_TYPES = [
  'CAC',
  'TAX_CLEARANCE',
  'BANK_VERIFICATION',
  'OTHER',
] as const;

export type VendorComplianceType = (typeof VENDOR_COMPLIANCE_TYPES)[number];

export const REQUIRED_VENDOR_COMPLIANCE: readonly VendorComplianceType[] = [
  'CAC',
  'TAX_CLEARANCE',
  'BANK_VERIFICATION',
];

export const VENDOR_ONBOARDING_KEY = 'vendor-onboarding-v1';

export const VENDOR_NAV_PERMISSIONS: readonly PermissionKey[] = [
  'vendor.view',
  'vendor.create',
  'vendor.activate',
];

export function hasVendorNavPermission(permissions: readonly string[]): boolean {
  return VENDOR_NAV_PERMISSIONS.some((key) => permissions.includes(key));
}

const VENDOR_MANAGE_KEYS = [
  'vendor.create',
  'vendor.activate',
  'vendor.suspend',
  'vendor.blacklist',
] as const;

export function canReadVendorRegister(permissions: readonly string[]): boolean {
  return permissions.includes('vendor.view') || permissions.includes('procurement.create');
}

/** Full status filters and draft editing. View-only callers see Active vendors. */
export function canManageVendorRegister(permissions: readonly string[]): boolean {
  return VENDOR_MANAGE_KEYS.some((key) => permissions.includes(key));
}

export interface VendorContact {
  name: string;
  phone?: string | null;
  email?: string | null;
  role?: string | null;
}

/** Stable seed id for XYZ Limited, aligned with the M4 milling-machine fixture. */
export const XYZ_VENDOR_ID = '00000000-0000-4000-8000-000000000201';
export const XYZ_VENDOR_REFERENCE = 'VND-000018';
export const SAHEL_VENDOR_ID = '00000000-0000-4000-8000-000000000202';
export const NORTHERN_SACKS_VENDOR_ID = '00000000-0000-4000-8000-000000000203';
/** A second active vendor, so proposals can compare at least two quotations. */
export const ALADE_VENDOR_ID = '00000000-0000-4000-8000-000000000204';
