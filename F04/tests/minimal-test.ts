/// <reference types="playwright/test" />
import { test, expect } from '@playwright/test';

test('minimal', async () => {
  expect(true).toBe(true);
});
