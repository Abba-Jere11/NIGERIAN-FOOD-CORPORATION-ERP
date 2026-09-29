import { defineConfig } from 'vitest/config';

/**
 * Vitest covers unit tests beside the source. The `e2e` directory belongs to
 * Playwright, which has its own runner and its own `test` export, so it is
 * excluded here rather than left to be collected by whichever runs first.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**', '.next/**'],
  },
});
