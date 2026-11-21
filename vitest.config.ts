import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const alias = { '@': fileURLToPath(new URL('./src', import.meta.url)) };
// Logik der Mitarbeiter-App (ohne React Native): eigener Alias auf mobile/src.
const mobileAlias = { '@': fileURLToPath(new URL('./mobile/src', import.meta.url)) };

export default defineConfig({
  resolve: { alias },
  test: {
    // Integration files share one database: run test files one after another.
    fileParallelism: false,
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        resolve: { alias: mobileAlias },
        test: {
          name: 'mobile',
          environment: 'node',
          include: ['mobile/src/**/*.test.ts'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
          globalSetup: ['tests/integration/global-setup.ts'],
          setupFiles: ['tests/integration/env.ts'],
          testTimeout: 20_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
