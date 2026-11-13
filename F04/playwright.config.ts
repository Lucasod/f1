import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*-playwright.ts',
  timeout: 30000,
  expect: {
    timeout: 5000,
  },
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:8000',
    trace: 'on-first-retry',
    viewport: { width: 1280, height: 720 },
    actionTimeout: 5000,
    navigationTimeout: 30000,
    // Critical: send cookies with same-origin POST requests
    withCredentials: true,
  },
});