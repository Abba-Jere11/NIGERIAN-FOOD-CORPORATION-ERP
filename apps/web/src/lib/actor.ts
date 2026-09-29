import { cookies } from 'next/headers';
import { DEFAULT_DEV_ACTOR_KEY, devActorKeys } from '@nfc/shared';

/**
 * Which demo actor the browser is currently acting as.
 *
 * M1 has no authentication, so there is no session to read. The selected actor
 * is held in a cookie and forwarded to the API as the `x-dev-actor` header. The
 * API then resolves the role and scope and enforces them server-side, so what
 * the interface shows and what the server permits cannot diverge.
 *
 * M2 replaces this with a real session cookie and removes the switcher.
 */
export const ACTOR_COOKIE = 'nfc_dev_actor';

export async function getSelectedActorKey(): Promise<string> {
  const store = await cookies();
  const value = store.get(ACTOR_COOKIE)?.value;
  if (value && devActorKeys().includes(value)) return value;
  return DEFAULT_DEV_ACTOR_KEY;
}
