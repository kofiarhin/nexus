import { defineConfig } from 'vitest/config';

/**
 * Server tests run in Node. Component tests opt into jsdom with a
 * `@vitest-environment jsdom` docblock, which keeps the fast Node default for
 * the majority of the suite.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{js,jsx}'],
    restoreMocks: true,
    clearMocks: true
  }
});
