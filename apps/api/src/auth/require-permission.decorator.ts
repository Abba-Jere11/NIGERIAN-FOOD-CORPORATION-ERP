import { SetMetadata } from '@nestjs/common';
import type { PermissionKey } from '@nfc/shared';

export const REQUIRED_PERMISSION_KEY = 'nfc:required-permission';
export const ACTOR_ONLY_KEY = 'nfc:actor-only';

/** Declares the permission an endpoint requires. Checked server-side (R4). */
export const RequirePermission = (permission: PermissionKey): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_PERMISSION_KEY, permission);

/**
 * For endpoints that any signed-in actor may call because they only describe
 * the caller themselves, such as "who am I". Still requires a resolved actor.
 */
export const ActorOnly = (): MethodDecorator & ClassDecorator => SetMetadata(ACTOR_ONLY_KEY, true);
