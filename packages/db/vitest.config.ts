import { defineConfig } from 'vitest/config';

/**
 * Two projects, because they have different requirements.
 *
 * `unit` needs nothing but Node, so it runs on any checkout and keeps the fast
 * feedback loop fast. `integration` needs a real PostgreSQL, because the things
 * it proves - append-only triggers, Row-Level Security, privilege grants - do
 * not exist outside the database and cannot be meaningfully faked.
 *
 * Run one or the other with `vitest run --project unit`.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['test/**/*.test.ts'],
          globalSetup: ['./test/global-setup.ts'],
          // One process for the whole suite. These tests share one database, so
          // running the files in parallel would have them competing for the same
          // rows and a failure would depend on timing rather than on the thing
          // being tested.
          pool: 'forks',
          poolOptions: { forks: { singleFork: true } },
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
