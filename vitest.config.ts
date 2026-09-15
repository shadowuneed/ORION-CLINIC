import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    passWithNoTests: false,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['lib/**/*.test.ts', 'app/**/*.test.ts'],
          exclude: ['lib/repositories/**/*.test.ts'],
          testTimeout: 5000,
        },
      },
      {
        extends: true,
        test: {
          name: 'database-integration',
          include: ['lib/repositories/**/*.test.ts', 'db/**/*.test.ts'],
          // These tests install the complete forward migration chain and exercise
          // multiple transactional commands. This is not an application deadline.
          testTimeout: 20000,
        },
      },
    ],
  },
});
