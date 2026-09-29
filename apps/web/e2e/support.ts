import { expect, type Page } from '@playwright/test';

/**
 * Switches the acting identity, which in M1 is the dev-actor bridge standing in
 * for authentication. The select is the same control a developer uses, so the
 * tests exercise the real path rather than setting a cookie behind the
 * application's back.
 */
export async function actAs(page: Page, actorKey: string): Promise<void> {
  const switcher = page.getByLabel('Acting as');
  await expect(switcher).toBeVisible();
  await switcher.selectOption(actorKey);
  // The server action revalidates the layout, so wait for the identity to change
  // rather than for a fixed delay.
  await expect(switcher).toHaveValue(actorKey);
  await page.waitForLoadState('networkidle');
}

export async function goto(page: Page, path: string, actorKey?: string): Promise<void> {
  await page.goto(path);
  if (actorKey) {
    await actAs(page, actorKey);
    if (page.url().endsWith(path) === false) await page.goto(path);
  }
}

/** A unique suffix, so a re-run does not collide with rows left by the last one. */
export function unique(prefix: string): string {
  return `${prefix} ${Date.now().toString(36).toUpperCase()}`;
}
