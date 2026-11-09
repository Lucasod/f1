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
 *   Isolation : Vendor B cannot access Vendor A's OVG (403).
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

// Documented seed fallbacks (scripts/seed.ts:
//   SEED_VENDOR_TECH_STORE_PASSWORD / SEED_VENDOR_FASHION_HUB_PASSWORD ??
//   TEST_USER_PASSWORD). These are not real credentials and are never printed.
const VENDOR_PASSWORD_CANDIDATES = ['vendor-secret', 'test_password_placeholder'];

const OVG_FULFILLABLE_STATUSES: readonly string[] = ['PENDING', 'CONFIRMED'];

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
 * Tries the documented seed password candidates and returns the first token
 * that works, or null when none are configured in this environment.
 */
async function loginVendor(page: Page, email: string): Promise<string | null> {
  for (const password of VENDOR_PASSWORD_CANDIDATES) {
    try {
      const result = await loginViaApi(page, email, password);
      if (result.accessToken) {
        return result.accessToken;
      }
    } catch {
      // Backend unreachable or request error; try the next candidate.
      continue;
    }
  }
  return null;
}

/**
 * Find the vendor's first OVG in PENDING or CONFIRMED status.
 */
async function findFulfillableOVG(page: Page, token: string): Promise<OvgRef | null> {
  const response = await apiFetch(page, 'GET', '/api/v1/vendor/orders', undefined, token);
  if (!response.ok()) return null;
  const data = await response.json();
  const groups: any[] = data?.vendorGroups ?? [];
  for (const group of groups) {
    if (OVG_FULFILLABLE_STATUSES.includes(group.status)) {
      return {
        orderId: group.orderId,
        vendorGroupId: group.id,
        status: group.status,
      };
    }
  }
  return null;
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
    if (currentStatusA === 'PENDING') {
      const confirmResp = await transitionOVG(
        page,
        tokenA,
        ovgA.orderId,
        ovgA.vendorGroupId,
        'CONFIRMED'
      );
      expect(confirmResp.statusCode).toBe(200);
      expect(
        confirmResp.order?.vendorGroups?.find((g: any) => g.id === ovgA.vendorGroupId)?.status
      ).toBe('CONFIRMED');
      currentStatusA = 'CONFIRMED';
      console.log(`[Step 21] OVG ${ovgA.vendorGroupId} confirmed`);
    }

    // ---- Step 22: CONFIRMED -> PREPARING (order PAID -> PROCESSING) ----
    const prepareResp = await transitionOVG(
      page,
      tokenA,
      ovgA.orderId,
      ovgA.vendorGroupId,
      'PREPARING'
    );
    expect(prepareResp.statusCode).toBe(200);
    expect(
      prepareResp.order?.vendorGroups?.find((g: any) => g.id === ovgA.vendorGroupId)?.status
    ).toBe('PREPARING');
    currentStatusA = 'PREPARING';
    console.log(`[Step 22] OVG ${ovgA.vendorGroupId} preparing`);

    // Verify via GET /api/v1/orders/:orderId
    const groupsAfterPrepare = await orderVendorGroups(page, tokenA, ovgA.orderId);
    expect(ovgStatus(groupsAfterPrepare, ovgA.vendorGroupId)).toBe('PREPARING');

    // ---- Step 23: PREPARING -> SHIPPED (order -> SHIPPED) ----
    const shipResp = await transitionOVG(
      page,
      tokenA,
      ovgA.orderId,
      ovgA.vendorGroupId,
      'SHIPPED'
    );
    expect(shipResp.statusCode).toBe(200);
    expect(
      shipResp.order?.vendorGroups?.find((g: any) => g.id === ovgA.vendorGroupId)?.status
    ).toBe('SHIPPED');
    currentStatusA = 'SHIPPED';
    console.log(`[Step 23] OVG ${ovgA.vendorGroupId} shipped`);

    const groupsAfterShip = await orderVendorGroups(page, tokenA, ovgA.orderId);
    expect(ovgStatus(groupsAfterShip, ovgA.vendorGroupId)).toBe('SHIPPED');

    // ---- Step 24: SHIPPED -> DELIVERED ----
    const deliverResp = await transitionOVG(
      page,
      tokenA,
      ovgA.orderId,
      ovgA.vendorGroupId,
      'DELIVERED'
    );
    expect(deliverResp.statusCode).toBe(200);
    expect(
      deliverResp.order?.vendorGroups?.find((g: any) => g.id === ovgA.vendorGroupId)?.status
    ).toBe('DELIVERED');
    currentStatusA = 'DELIVERED';
    console.log(`[Step 24] OVG ${ovgA.vendorGroupId} delivered`);

    const groupsAfterDeliver = await orderVendorGroups(page, tokenA, ovgA.orderId);
    expect(ovgStatus(groupsAfterDeliver, ovgA.vendorGroupId)).toBe('DELIVERED');

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

    // Vendor B cannot access Vendor A's order (GET /api/v1/orders/:orderId -> 403)
    const crossAccessResp = await apiFetch(
      page,
      'GET',
      `/api/v1/orders/${ovgA.orderId}`,
      undefined,
      tokenB
    );
    expect(crossAccessResp.status()).toBe(403);
    console.log(
      `[Isolation] Vendor B GET Vendor A's order ${ovgA.orderId} -> ${crossAccessResp.status()}`
    );

    // Vendor B cannot transition Vendor A's OVG (PATCH -> 403)
    const crossTransitionResp = await transitionOVG(
      page,
      tokenB,
      ovgA.orderId,
      ovgA.vendorGroupId,
      'PREPARING'
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
    if (currentStatusB === 'PENDING') {
      const confirmResp = await transitionOVG(
        page,
        tokenB,
        ovgB.orderId,
        ovgB.vendorGroupId,
        'CONFIRMED'
      );
      expect(confirmResp.statusCode).toBe(200);
      currentStatusB = 'CONFIRMED';
      console.log(`[Step 25] Vendor B OVG ${ovgB.vendorGroupId} confirmed`);
    }

    const prepareRespB = await transitionOVG(
      page,
      tokenB,
      ovgB.orderId,
      ovgB.vendorGroupId,
      'PREPARING'
    );
    expect(prepareRespB.statusCode).toBe(200);
    console.log(`[Step 25] Vendor B OVG ${ovgB.vendorGroupId} preparing`);

    const shipRespB = await transitionOVG(
      page,
      tokenB,
      ovgB.orderId,
      ovgB.vendorGroupId,
      'SHIPPED'
    );
    expect(shipRespB.statusCode).toBe(200);
    console.log(`[Step 25] Vendor B OVG ${ovgB.vendorGroupId} shipped`);

    const deliverRespB = await transitionOVG(
      page,
      tokenB,
      ovgB.orderId,
      ovgB.vendorGroupId,
      'DELIVERED'
    );
    expect(deliverRespB.statusCode).toBe(200);
    expect(
      deliverRespB.order?.vendorGroups?.find((g: any) => g.id === ovgB.vendorGroupId)?.status
    ).toBe('DELIVERED');
    console.log(`[Step 25] Vendor B OVG ${ovgB.vendorGroupId} delivered`);

    // ---- Step 10: order reaches DELIVERED when all OVGs are DELIVERED ----
    const finalGroupsB = await orderVendorGroups(page, tokenB, ovgB.orderId);
    expect(finalGroupsB).not.toBeNull();
    const bGroupDelivered = ovgStatus(finalGroupsB, ovgB.vendorGroupId) === 'DELIVERED';
    expect(bGroupDelivered).toBe(true);

    // When Vendor B shares the order with Vendor A, both vendors' OVGs are
    // DELIVERED, so the order reaches DELIVERED (backend lifecycle).
    const sharedOrder = ovgB.orderId === ovgA.orderId;
    if (sharedOrder) {
      const finalGroupsA = await orderVendorGroups(page, tokenA, ovgA.orderId);
      const aGroupDelivered = ovgStatus(finalGroupsA, ovgA.vendorGroupId) === 'DELIVERED';
      expect(aGroupDelivered).toBe(true);
      const allDelivered =
        (finalGroupsA ?? []).concat(finalGroupsB ?? []).every((g: any) => g.status === 'DELIVERED');
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
