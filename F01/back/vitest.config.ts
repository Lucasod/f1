import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    autoload: true,
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test/env.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/', '**/*.test.ts', '**/*.d.ts']
    },
    testTimeout: 60000
  }
});