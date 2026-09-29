'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { devActorKeys } from '@nfc/shared';
import { ACTOR_COOKIE } from '@/lib/actor';

/**
 * Sets the acting identity for this browser (M1's dev-actor bridge).
 *
 * The cookie only names which demo actor to present to the API; it grants
 * nothing. The API resolves the role and scope itself and refuses anything that
 * actor may not do, so tampering with the cookie changes who you are, never what
 * you are permitted to do.
 */
export async function selectActor(key: string): Promise<void> {
  if (!devActorKeys().includes(key)) {
    throw new Error(`Unknown actor "${key}".`);
  }

  const store = await cookies();
  store.set(ACTOR_COOKIE, key, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 12,
  });

  revalidatePath('/', 'layout');
}
