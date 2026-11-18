/// <reference types="playwright/test" />
import { test, expect } from '@playwright/test';

// Accessibility test page served locally (frontend container not yet serving HTML).
const BASE = 'http://127.0.0.1:8765/accessibility-board.html';

test.describe('NFR-12 Accessibility Review (focus-visible)', () => {

  // ------------------------------------------------------------------
  // 1. English labels
  // ------------------------------------------------------------------
  test('1. English labels throughout the UI', async ({ page }) => {
    await page.goto(BASE + '?state=board');

    // Brand / header
    await expect(page.getByRole('link', { name: 'ProjectBoard' })).toBeVisible();

    // Board heading
    await expect(page.getByRole('heading', { name: 'Board', level: 2 })).toBeVisible();

    // Create issue button
    await expect(page.getByRole('button', { name: '+ Create issue' })).toBeVisible();

    // Column headings (English)
    await expect(page.getByRole('heading', { name: 'To do', level: 3 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'In progress', level: 3 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Done', level: 3 })).toBeVisible();

    // Issue card labels (English titles)
    await expect(page.getByRole('button', { name: /Issue 101: Fix login validation/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Issue 102: Add workspace selector/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Issue 103: Implement issue transitions/ })).toBeVisible();

    // Priority and status badges (English)
    await expect(page.locator('[data-priority="high"]').first()).toContainText('High');
    await expect(page.locator('[data-priority="medium"]').first()).toContainText('Medium');
    await expect(page.locator('.issue-card__badge--status').first()).toContainText('To do');
    await expect(page.locator('.issue-card__badge--status').last()).toContainText('In progress');

    // No Portuguese or other non-English labels present
    await expect(page.locator('text=Carregar')).not.toBeVisible();
    await expect(page.locator('text=Vazio')).not.toBeVisible();
    await expect(page.locator('text=Nenhum')).not.toBeVisible();
    await expect(page.locator('text=Sem dados')).not.toBeVisible();
  });

  // ------------------------------------------------------------------
  // 2. Loading states
  // ------------------------------------------------------------------
  test('2. Loading state renders LoadingSpinner with role="status" and aria-label', async ({ page }) => {
    await page.goto(BASE + '?state=loading');

    const spinner = page.getByRole('status');
    await expect(spinner).toBeVisible();
    await expect(spinner).toHaveAttribute('aria-label', 'Loading board…');

    // Sr-only span present
    await expect(page.locator('.sr-only')).toContainText('Loading board…');

    // Board content should NOT be visible while loading
    await expect(page.getByRole('heading', { name: 'Board', level: 2 })).not.toBeVisible();
  });

  // ------------------------------------------------------------------
  // 3. Empty states
  // ------------------------------------------------------------------
  test('3. Empty state renders EmptyState when no data', async ({ page }) => {
    await page.goto(BASE + '?state=empty');

    const empty = page.getByText('Select a project');
    await expect(empty).toBeVisible();

    // Icon hidden from screen readers
    const icon = page.locator('.empty-state__icon');
    await expect(icon).toHaveAttribute('aria-hidden', 'true');

    // Message present
    await expect(page.getByText('Open a project from the project list to view its board.')).toBeVisible();
  });

  // ------------------------------------------------------------------
  // 4. Error states
  // ------------------------------------------------------------------
  test('4. Error state renders ErrorBoundary with role="alert"', async ({ page }) => {
    await page.goto(BASE + '?state=error');

    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('Something went wrong');
    await expect(alert).toContainText('Failed to load board. Please try again.');

    // Retry button present
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  });

  // ------------------------------------------------------------------
  // 5. Visible keyboard focus (:focus-visible)
  // ------------------------------------------------------------------
  test('5. Visible keyboard focus on interactive elements when tabbing', async ({ page }) => {
    await page.goto(BASE + '?state=board');

    // Tab to the first interactive element (brand link)
    await page.keyboard.press('Tab');
    const brand = page.getByRole('link', { name: 'ProjectBoard' });
    await expect(brand).toBeFocused();

    // Verify :focus-visible matches and a visible outline is applied
    const brandFocus = await brand.evaluate((el) => {
      const matches = el.matches(':focus-visible');
      const comp = window.getComputedStyle(el);
      return { matches, outline: comp.outline, outlineOffset: comp.outlineOffset };
    });
    expect(brandFocus.matches).toBe(true);
    expect(brandFocus.outline).not.toBe('none');
    expect(brandFocus.outline).not.toBe('');

    // Tab to Create issue button
    await page.keyboard.press('Tab');
    const createBtn = page.getByRole('button', { name: '+ Create issue' });
    await expect(createBtn).toBeFocused();

    // Tab into issue cards (role="button", tabIndex={0})
    await page.keyboard.press('Tab');
    const firstCard = page.getByRole('button', { name: /Issue 101:/ });
    await expect(firstCard).toBeFocused();

    // Verify focus-visible matches and outline on the card
    const cardFocus = await firstCard.evaluate((el) => {
      const matches = el.matches(':focus-visible');
      const comp = window.getComputedStyle(el);
      return { matches, outline: comp.outline };
    });
    expect(cardFocus.matches).toBe(true);
    expect(cardFocus.outline).not.toBe('none');
    expect(cardFocus.outline).not.toBe('');
  });

  // ------------------------------------------------------------------
  // 6. Keyboard-accessible issue movement (arrow keys, no drag-and-drop)
  // ------------------------------------------------------------------
  test('6. Arrow keys move focus between issue cards without drag-and-drop', async ({ page }) => {
    await page.goto(BASE + '?state=board');

    // Focus the first issue card
    const firstCard = page.getByRole('button', { name: /Issue 101:/ });
    await firstCard.focus();
    await expect(firstCard).toBeFocused();

    // ArrowDown / ArrowRight moves to next card
    await page.keyboard.press('ArrowDown');
    const secondCard = page.getByRole('button', { name: /Issue 102:/ });
    await expect(secondCard).toBeFocused();

    // ArrowRight again moves to third card (in next column)
    await page.keyboard.press('ArrowRight');
    const thirdCard = page.getByRole('button', { name: /Issue 103:/ });
    await expect(thirdCard).toBeFocused();

    // ArrowUp / ArrowLeft moves back to previous card
    await page.keyboard.press('ArrowUp');
    await expect(secondCard).toBeFocused();

    // Wrap-around: ArrowUp from first card goes to last card
    await page.keyboard.press('ArrowUp'); // 102 -> 101
    await expect(firstCard).toBeFocused();
    await page.keyboard.press('ArrowUp'); // 101 -> 103 (wrap)
    await expect(thirdCard).toBeFocused();

    // Verify cards have keyboard-accessible attributes
    await expect(firstCard).toHaveAttribute('role', 'button');
    await expect(firstCard).toHaveAttribute('tabindex', '0');
    await expect(firstCard).toHaveAttribute('aria-grabbable', 'true');
  });

  // ------------------------------------------------------------------
  // 7. Screen reader support (aria-labels, roles, semantics)
  // ------------------------------------------------------------------
  test('7. Screen reader support: aria-labels, roles, and semantics', async ({ page }) => {
    await page.goto(BASE + '?state=board');

    // Issue cards have aria-label
    await expect(page.getByRole('button', { name: /Issue 101: Fix login validation/ })).toHaveAttribute('aria-label', 'Issue 101: Fix login validation');
    await expect(page.getByRole('button', { name: /Issue 103: Implement issue transitions/ })).toHaveAttribute('aria-label', 'Issue 103: Implement issue transitions');

    // Issue cards are role="button"
    await expect(page.getByRole('button', { name: /Issue 101:/ })).toHaveAttribute('role', 'button');

    // Drag handle hidden from screen readers
    const dragHandle = page.locator('.issue-card__drag-handle');
    await expect(dragHandle.first()).toHaveAttribute('aria-hidden', 'true');

    // Columns have aria-label
    await expect(page.getByRole('region', { name: 'To do' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'In progress' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Done' })).toBeVisible();

    // Error boundary uses role="alert" (verified in test 4, re-check here)
    await page.goto(BASE + '?state=error');
    await expect(page.getByRole('alert')).toBeVisible();
  });

});
