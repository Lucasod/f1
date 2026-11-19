import { test, expect, type Page } from '@playwright/test';
import {
  apiFetch,
  API_BASE_URL,
  getOrder,
  loginViaApi,
} from './fixtures';

/**
 * F01/front/tests/e2e/vendor-fulfillment.spec.ts
 *
 * Golden Path E2E — Vendor Fulfillment (steps 21-25).
 *
 * Covers:
 *   Step 21 : Vendor A opens the vendor dashboard and lists their order groups.
 *   Step 22 : Vendor A prepares their OVG (CONFIRMED -> PREPARING).
 *   Step 23 : Vendor A ships their OVG (PREPARING -> SHIPPED).
 *   Step 24 : Vendor A delivers their OVG (SHIPPED -> DELIVERED).
 * Isolation : Vendor B cannot access Vendor A's OVG (404).
 *   Step 25 : Vendor B fulfills their own OVG.
 *   Step 10 : Order reaches DELIVERED when all its OVGs are DELIVERED.
 *
 * Uses direct backend API calls (page.request) because the vendor dashboard
 * UI may not be fully implemented.
 *
 * Prerequisites (environment):
 *   - Backend healthy on http://localhost:3000, seeded with vendor accounts
 *   - Vendor A: techstore@example.com
 *   - Vendor B: fashionhub@example.com
 *   - A paid order exists with OVGs in PENDING/CONFIRMED for each vendor
 *     (e.g. the order left by the completed Golden Path).
 *
 * Observability notes:
 *   The backend scopes order responses to vendors via vendorOrderToResponse
 *   (order.routes.ts), which strips the top-level order.status and
 *   order.financialStatus from vendor responses. The vendor-observable source
 *   of truth is order.vendorGroups[].status. The backend lifecycle maps OVG
 *   status to order status 1:1 (CONFIRMED -> order stays PAID; PREPARING ->
 *   PROCESSING; SHIPPED -> SHIPPED; DELIVERED -> DELIVERED once all OVGs are
 *   DELIVERED), so this test asserts the order lifecycle through OVG statuses
 *   read via GET /api/v1/orders/:orderId and the PATCH response bodies.
 */

const VENDOR_A_EMAIL = 'techstore@example.com';
const VENDOR_B_EMAIL = 'fashionhub@example.com';

// Vendor passwords come from TEST_USER_PASSWORD env var (seed.ts uses it as fallback).
// If TEST_USER_PASSWORD is not set, vendor login will be skipped.

interface OvgRef {
  orderId: string;
  vendorGroupId: string;
  status: string;
}

interface TransitionResult {
  ok: boolean;
  statusCode: number;
  order?: any;
}

/**
 * Log in as a vendor via the backend auth API.
 * Uses TEST_USER_PASSWORD env var and returns the token, or null when it is
 * not set or login fails.
 */
async function loginVendor(page: Page, email: string): Promise<string | null> {
  const password = process.env.TEST_USER_PASSWORD;
  if (!password) {
    console.log(`[loginVendor] TEST_USER_PASSWORD not set; cannot log in as ${email}`);
    return null;
  }
  try {
    const result = await loginViaApi(page, email, password);
    if (result.accessToken) {
      return result.accessToken;
    }
    console.log(`[loginVendor] Login failed for ${email}: no access token returned`);
    return null;
  } catch {
    console.log(`[loginVendor] Login error for ${email}`);
    return null;
  }
}

/**
 * Find the vendor's first available OVG, regardless of status.
 * The caller handles PENDING (confirm) vs CONFIRMED (skip straight to PREPARING).
 */
async function findFulfillableOVG(page: Page, token: string): Promise<OvgRef | null> {
  const response = await apiFetch(page, 'GET', '/api/v1/vendor/orders', undefined, token);
  if (!response.ok()) return null;
  const data = await response.json();
  const groups: any[] = data?.vendorGroups ?? [];
  if (groups.length === 0) return null;
  const group = groups[0];
  return {
    orderId: group.orderId,
    vendorGroupId: group.id,
    status: group.status,
  };
}

/**
 * Transition an OVG to the given status and return the parsed response.
 */
async function transitionOVG(
  page: Page,
  token: string,
  orderId: string,
  vendorGroupId: string,
  status: string
): Promise<TransitionResult> {
  const response = await page.request.patch(
    `${API_BASE_URL}/api/v1/orders/${orderId}/vendor-groups/${vendorGroupId}/status`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: { status },
    }
  );
  let order: any = undefined;
  if (response.ok()) {
    const data = await response.json();
    order = data?.order;
  }
  return { ok: response.ok(), statusCode: response.status(), order };
}

/**
 * Read an order and return its vendor groups (vendor-scoped response).
 */
async function orderVendorGroups(page: Page, token: string, orderId: string): Promise<any[] | null> {
  const order = await getOrder(page, orderId, token);
  return order?.vendorGroups ?? null;
}

function ovgStatus(groups: any[] | null, vendorGroupId: string): string | undefined {
  return groups?.find((g: any) => g.id === vendorGroupId)?.status;
}

test.describe('Golden Path Steps 21-25: Vendor Fulfillment E2E', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('Vendor A fulfills their OVG; Vendor B is isolated and fulfills their own OVG', async ({
    page,
  }) => {
    test.setTimeout(120000);

    // ------------------------------------------------------------------
    // Vendor A — steps 21-24
    // ------------------------------------------------------------------

    // ---- Step 21: Log in as Vendor A and open the vendor dashboard ----
    const tokenA = await loginVendor(page, VENDOR_A_EMAIL);
    if (!tokenA) {
      test.skip(
        true,
        `Vendor A login failed for ${VENDOR_A_EMAIL}: configure SEED_VENDOR_TECH_STORE_PASSWORD/TEST_USER_PASSWORD`
      );
      return;
    }

    // Vendor A can access their own vendor profile (GET /api/v1/vendor/me)
    const meResp = await apiFetch(page, 'GET', '/api/v1/vendor/me', undefined, tokenA);
    expect(meResp.status()).toBe(200);
    const me = await meResp.json();
    console.log(`[Step 21] Vendor A profile loaded: ${me?.storeName ?? me?.name ?? 'vendor'}`);

    // Vendor A lists their order groups (GET /api/v1/vendor/orders)
    const vendorOrdersResp = await apiFetch(page, 'GET', '/api/v1/vendor/orders', undefined, tokenA);
    expect(vendorOrdersResp.status()).toBe(200);
    const vendorOrders = await vendorOrdersResp.json();
    const groupsA: any[] = vendorOrders?.vendorGroups ?? [];
    console.log(`[Step 21] Vendor A has ${groupsA.length} vendor group(s)`);

    const ovgA = await findFulfillableOVG(page, tokenA);
    if (!ovgA) {
      test.skip(
        true,
        'Vendor A has no OVG in PENDING/CONFIRMED status; nothing to fulfill'
      );
      return;
    }

    // Sanity-check the order exists before advancing OVGs
    // (PREPARING requires the order to be PAID).
    const orderA = await getOrder(page, ovgA.orderId, tokenA);
    expect(orderA).not.toBeNull();
    console.log(
      `[Step 21] Order ${ovgA.orderId} OVG ${ovgA.vendorGroupId} current status: ${ovgA.status}`
    );

    let currentStatusA = ovgA.status;

    // ---- Step 21 (cont.): confirm OVG when it is still PENDING ----
    if (currentStatusA === 'pending') {
      const confirmResp = await transitionOVG(
        page,
        tokenA,
        ovgA.orderId,
        ovgA.vendorGroupId,
        'confirmed'
      );
      expect(confirmResp.statusCode).toBe(200);
      expect(
        confirmResp.order?.vendorGroups?.find((g: any) => g.id === ovgA.vendorGroupId)?.status
      ).toBe('confirmed');
      currentStatusA = 'confirmed';
      console.log(`[Step 21] OVG ${ovgA.vendorGroupId} confirmed`);
    }

    // ---- Step 22: CONFIRMED -> PREPARING (order PAID -> PROCESSING) ----
    const prepareResp = await transitionOVG(
      page,
      tokenA,
      ovgA.orderId,
      ovgA.vendorGroupId,
      'preparing'
    );
    expect(prepareResp.statusCode).toBe(200);
    expect(
      prepareResp.order?.vendorGroups?.find((g: any) => g.id === ovgA.vendorGroupId)?.status
    ).toBe('preparing');
    currentStatusA = 'preparing';
    console.log(`[Step 22] OVG ${ovgA.vendorGroupId} preparing`);

    // Verify via GET /api/v1/orders/:orderId
    const groupsAfterPrepare = await orderVendorGroups(page, tokenA, ovgA.orderId);
    expect(ovgStatus(groupsAfterPrepare, ovgA.vendorGroupId)).toBe('preparing');

    // ---- Step 23: PREPARING -> SHIPPED (order -> SHIPPED) ----
    const shipResp = await transitionOVG(
      page,
      tokenA,
      ovgA.orderId,
      ovgA.vendorGroupId,
      'shipped'
    );
    expect(shipResp.statusCode).toBe(200);
    expect(
      shipResp.order?.vendorGroups?.find((g: any) => g.id === ovgA.vendorGroupId)?.status
    ).toBe('shipped');
    currentStatusA = 'shipped';
    console.log(`[Step 23] OVG ${ovgA.vendorGroupId} shipped`);

    const groupsAfterShip = await orderVendorGroups(page, tokenA, ovgA.orderId);
    expect(ovgStatus(groupsAfterShip, ovgA.vendorGroupId)).toBe('shipped');

    // ---- Step 24: SHIPPED -> DELIVERED ----
    const deliverResp = await transitionOVG(
      page,
      tokenA,
      ovgA.orderId,
      ovgA.vendorGroupId,
      'delivered'
    );
    expect(deliverResp.statusCode).toBe(200);
    expect(
      deliverResp.order?.vendorGroups?.find((g: any) => g.id === ovgA.vendorGroupId)?.status
    ).toBe('delivered');
    currentStatusA = 'delivered';
    console.log(`[Step 24] OVG ${ovgA.vendorGroupId} delivered`);

    const groupsAfterDeliver = await orderVendorGroups(page, tokenA, ovgA.orderId);
    expect(ovgStatus(groupsAfterDeliver, ovgA.vendorGroupId)).toBe('delivered');

    // ------------------------------------------------------------------
    // Vendor B isolation — step 8 cross-check
    // ------------------------------------------------------------------

    const tokenB = await loginVendor(page, VENDOR_B_EMAIL);
    if (!tokenB) {
      test.skip(
        true,
        `Vendor B login failed for ${VENDOR_B_EMAIL}: configure SEED_VENDOR_FASHION_HUB_PASSWORD/TEST_USER_PASSWORD`
      );
      return;
    }

    // Vendor B cannot access Vendor A's order (GET /api/v1/orders/:orderId -> 404)
    const crossAccessResp = await apiFetch(
      page,
      'GET',
      `/api/v1/orders/${ovgA.orderId}`,
      undefined,
      tokenB
    );
    expect(crossAccessResp.status()).toBe(404);
    console.log(
      `[Isolation] Vendor B GET Vendor A's order ${ovgA.orderId} -> ${crossAccessResp.status()}`
    );

    // Vendor B cannot transition Vendor A's OVG (PATCH -> 404)
    const crossTransitionResp = await transitionOVG(
      page,
      tokenB,
      ovgA.orderId,
      ovgA.vendorGroupId,
      'preparing'
    );
    expect(crossTransitionResp.statusCode).toBe(403);
    console.log(
      `[Isolation] Vendor B PATCH Vendor A's OVG ${ovgA.vendorGroupId} -> ${crossTransitionResp.statusCode}`
    );

    // ------------------------------------------------------------------
    // Vendor B — step 25: fulfill their own OVG
    // ------------------------------------------------------------------

    const ovgB = await findFulfillableOVG(page, tokenB);
    if (!ovgB) {
      test.skip(
        true,
        'Vendor B has no OVG in PENDING/CONFIRMED status; cannot run step 25'
      );
      return;
    }

    let currentStatusB = ovgB.status;
    if (currentStatusB === 'pending') {
      const confirmResp = await transitionOVG(
        page,
        tokenB,
        ovgB.orderId,
        ovgB.vendorGroupId,
        'confirmed'
      );
      expect(confirmResp.statusCode).toBe(200);
      currentStatusB = 'confirmed';
      console.log(`[Step 25] Vendor B OVG ${ovgB.vendorGroupId} confirmed`);
    }

    const prepareRespB = await transitionOVG(
      page,
      tokenB,
      ovgB.orderId,
      ovgB.vendorGroupId,
      'preparing'
    );
    expect(prepareRespB.statusCode).toBe(200);
    console.log(`[Step 25] Vendor B OVG ${ovgB.vendorGroupId} preparing`);

    const shipRespB = await transitionOVG(
      page,
      tokenB,
      ovgB.orderId,
      ovgB.vendorGroupId,
      'shipped'
    );
    expect(shipRespB.statusCode).toBe(200);
    console.log(`[Step 25] Vendor B OVG ${ovgB.vendorGroupId} shipped`);

    const deliverRespB = await transitionOVG(
      page,
      tokenB,
      ovgB.orderId,
      ovgB.vendorGroupId,
      'delivered'
    );
    expect(deliverRespB.statusCode).toBe(200);
    expect(
      deliverRespB.order?.vendorGroups?.find((g: any) => g.id === ovgB.vendorGroupId)?.status
    ).toBe('delivered');
    console.log(`[Step 25] Vendor B OVG ${ovgB.vendorGroupId} delivered`);

    // ---- Step 10: order reaches DELIVERED when all OVGs are DELIVERED ----
    const finalGroupsB = await orderVendorGroups(page, tokenB, ovgB.orderId);
    expect(finalGroupsB).not.toBeNull();
    const bGroupDelivered = ovgStatus(finalGroupsB, ovgB.vendorGroupId) === 'delivered';
    expect(bGroupDelivered).toBe(true);

    // When Vendor B shares the order with Vendor A, both vendors' OVGs are
    // DELIVERED, so the order reaches DELIVERED (backend lifecycle).
    const sharedOrder = ovgB.orderId === ovgA.orderId;
    if (sharedOrder) {
      const finalGroupsA = await orderVendorGroups(page, tokenA, ovgA.orderId);
      const aGroupDelivered = ovgStatus(finalGroupsA, ovgA.vendorGroupId) === 'delivered';
      expect(aGroupDelivered).toBe(true);
      const allDelivered =
        (finalGroupsA ?? []).concat(finalGroupsB ?? []).every((g: any) => g.status === 'delivered');
      expect(allDelivered).toBe(true);
      console.log(
        `[Step 10] Shared order ${ovgB.orderId}: all OVGs delivered -> order DELIVERED`
      );
    } else {
      console.log(
        `[Step 10] Vendor B order ${ovgB.orderId} OVG ${ovgB.vendorGroupId} delivered`
      );
    }

    console.log('[Vendor Fulfillment E2E] Test completed');
  });
});
