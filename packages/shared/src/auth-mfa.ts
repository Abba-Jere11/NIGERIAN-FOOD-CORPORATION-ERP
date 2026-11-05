import type { RoleKey } from './org';

/** MFA is mandatory when an Administrator enabled it or the user holds Administrator. */
export function effectiveMfaRequired(
  mfaRequired: boolean,
  roleKeys: readonly RoleKey[],
): boolean {
  return mfaRequired || roleKeys.includes('administrator');
}
