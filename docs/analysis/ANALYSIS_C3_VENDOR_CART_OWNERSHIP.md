# C3: Vendor Cannot Add Products from Their Own Store to the Cart

## 1. Current State Analysis

### 1.1 How the Cart Currently Works

**`cart.service.ts` — `addItem(consumerId, productId, quantity)` method** (lines 30-70):

1. Validates quantity is a positive integer
2. Validates product exists via `productRepo.findById(productId)` → throws `CartError.PRODUCT_NOT_FOUND`
3. Validates product is available (`product.isAvailable`) → throws `CartError.PRODUCT_NOT_AVAILABLE`
4. Gets `vendorId` from `product.vendorId` (line 47)
5. Validates vendor exists via `vendorRepo.findById(vendorId)` → throws `CartError.VENDOR_NOT_FOUND`
6. Ensures cart exists (auto-creates if missing)
7. Calls `cartRepo.addItem(consumerId, productId, vendorId, quantity, price, maxStock)`

**Key observation**: The method already has access to `product.vendorId` and `vendorRepo`. The `consumerId` parameter is the person's ID (extracted from JWT `sub` in the routes via `getCartId(req)`).

**`cart.routes.ts` — POST /cart/items** (lines 76-128):
- Uses `optionalAuthMw` — if authenticated, `req.user` contains `JWTPayload` with `sub` (personId), `email`, `roles`
- If guest, no user, cart is created via `generateGuestCartId()`
- Calls `cartService.addItem(cartId, productId, quantity)`

### 1.2 How Vendor Service Works

**`vendor.service.ts`**:
- `onboardVendor(personId, input)`: Creates a `Vendor` record associated with a `Person`, adds `PersonRole.VENDOR` to the person's roles
- `getVendorByPersonId(personId)`: Returns the `Vendor` associated with a person via `vendorRepo.findByPersonId(personId)`
- `Vendor` class has `id` (vendor ID) and `personId` fields

**`vendor.domain.ts` — `InMemoryVendorRepository.findByPersonId(personId)`** (lines 162-166):
```typescript
async findByPersonId(personId: string): Promise<Vendor | null> {
  const vendorId = this.personIndex.get(personId);
  if (!vendorId) return null;
  return this.vendors.get(vendorId) || null;
}
```
Maps `personId → vendorId` via the `personIndex` built during `save()`.

### 1.3 Vendor Identification from Person

**`person.domain.ts` — `PersonRole` enum** (lines 31-35):
```typescript
export enum PersonRole {
  CONSUMER = 'CONSUMER',
  VENDOR = 'VENDOR',
  ADMIN = 'ADMIN'
}
```

**`person.domain.ts` — `Person` class** has `roles: Person[]` field.

**`vendor.service.onboardVendor()`** (lines 36-66):
1. Verifies person exists
2. Ensures person is not admin (`if (person.roles.includes(PersonRole.ADMIN)`)
3. Creates `Vendor` with `personId`, `storeName`, `slug`, `commissionPct`
4. Saves vendor (validates slug uniqueness & person-vendor association via `personIndex`)
5. Adds `PersonRole.VENDOR` to person's roles if not already present

**Result**: After onboarding, a person has:
- `PersonRole.VENDOR` in their `roles` array
- A `Vendor` record with `personId → vendor.id` mapping via `vendorRepo.findByPersonId()`

### 1.4 Ownership Validation Elsewhere (CD-059 Pattern)

**`product.service.ts`** uses a consistent ownership check pattern across multiple methods:

```typescript
// CD-059: Ownership check
if (!isAdmin && product.vendorId !== vendorId) {
  throw new Error(ProductError.PRODUCT_OWNERSHIP_VIOLATION);
}
```

This pattern appears in: `updateProduct`, `deleteProduct`, `inactivateProduct`, `activateProduct`, `updateProductStock`.

The pattern: if the caller is NOT an admin, and the product's `vendorId` does NOT match the caller's vendor ID, violate ownership.

**How it works**:
- The `vendorId` comes from the authenticated person's vendor record
- `isAdmin` checks `user.roles.includes(PersonRole.ADMIN)` from the JWT payload
- If not admin and vendorIds don't match → error

### 1.5 Current Cart Vulnerability

There is **no validation** preventing a vendor from adding their own products to the cart. The `addItem` method validates:
- Product exists ✓
- Product is available ✓
- Vendor exists ✓
- Stock is sufficient ✓ (via `updateItemQuantity`)

But it does **not** check whether the product's `vendorId` matches the current person's vendor ID.

---

## 2. Implementation Plan for C3

### 2.1 Recommended Implementation Location: `cart.service.ts` `addItem()` method

**Why not other options?**

| Option | Verdict |
|--------|---------|
| a. In `cart.service.ts` `addItem()` ✅ | Best — central validation point, has access to product and vendor repos, consistent with existing validation pattern |
| b. In new middleware/route handler ❌ | Would duplicate logic; harder to reuse; routes are thin |
| c. In `product.service.ts` ownership check pattern ❌ | Wrong layer — product ownership is for CRUD operations, not cart addition |

### 2.2 What the Check Must Verify

```
IF current person (consumerId) has an associated vendor
THEN IF product.vendorId === current person's vendor ID
     THEN THROW error — vendor cannot add their own products to cart
```

### 2.3 How to Get the Current Person's Vendor ID

1. `consumerId` is the person's ID (from JWT `sub`)
2. Call `vendorRepo.findByPersonId(consumerId)`:
   - If returns `null` → person is not a vendor → skip check (allow addition)
   - If returns `Vendor` → get `vendor.id` → compare with `product.vendorId`
3. If `product.vendorId === vendor.id` → throw error

**Alternative**: Check person's roles for `PersonRole.VENDOR` first, then load vendor. But `findByPersonId` is sufficient since:
- After onboarding, every person with VENDOR role has a vendor record
- If no vendor record exists, the person isn't really a vendor (even if role present, perhaps incomplete onboarding)

### 2.4 Error Message

Add new error to `CartError` enum in `cart.domain.ts`:

```typescript
export enum CartError {
  // ... existing errors
  VENDOR_CANNOT_ADD_OWN_PRODUCT = 'VENDOR_CANNOT_ADD_OWN_PRODUCT',
  // ...
}
```

Error message (in Portuguese per project convention, or English):
```
"Vendedores não podem adicionar produtos da própria loja ao carrinho"
```
or in English:
```
"Vendors cannot add products from their own store to the cart"
```

Looking at the project, the conventions seem mixed. The `CartError` enum uses English messages. I'll use English for consistency with the enum, but the API response can be localized.

Actually, looking more carefully at the codebase:
- `CartError` enum values are English strings like `'PRODUCT_NOT_FOUND'`
- Error messages in routes use both English and Portuguese
- The project rule says: "Domain concepts in code MUST use consistent English terminology"

I'll add the error code to the enum in English, and the message can be Portuguese or English depending on the API layer convention.

Let me add `VENDOR_CANNOT_ADD_OWN_PRODUCT` to the enum.

### 2.5 Integration with CD-059 Ownership Validation

The C3 check follows the **same pattern** as CD-059 but from the cart side:

| Aspect | CD-059 (product.service.ts) | C3 (cart.service.ts) |
|--------|------------------------------|----------------------|
| What's checked | `product.vendorId !== vendorId` | `product.vendorId === vendorRepo.findByPersonId(consumerId)?.id` |
| Who's validated | Admin vs non-admin caller | Vendor person vs product owner |
| Error type | `ProductError.PRODUCT_OWNERSHIP_VIOLATION` | New `CartError.VENDOR_CANNOT_ADD_OWN_PRODUCT` |
| Purpose | Prevent vendor from managing others' products | Prevent vendor from adding own products to cart |
| Scope | Product CRUD operations | Cart addition only |

The C3 check **uses the same core logic** (compare vendorIds) but in a different context (cart addition vs product management).

### 2.6 Frontend Validation

**Where to add the check**: In the frontend `ProductDetailPage` `handleAddToCart` function (line 128-173 of `ProductDetailPage.tsx`).

**What the check must do**:
1. Before calling `cartApi.addItem()`, check if the user is authenticated and has `PersonRole.VENDOR`
2. If vendor, show a disabled/explanatory message instead of the add-to-cart button
3. If not vendor, proceed normally

**However**: The **backend is the source of truth**. The frontend check is UX-only. A malicious user could bypass frontend by calling the API directly. The backend validation in `cart.service.ts` must remain.

**Frontend implementation approach**:
- In `useCartMutations()`, the `useAddItem` mutation currently doesn't vendor-check
- The `handleAddToCart` in `ProductDetailPage` can check user roles before calling the mutation
- Show a clear message: "Vendedores não podem adicionar produtos da própria loja ao carrinho"

---

## 3. Full Code Changes Needed

### 3.1 Backend: `cart.domain.ts` — Add new CartError

Add to the `CartError` enum:
```typescript
export enum CartError {
  // ... existing errors (lines 2-11)
  VENDOR_CANNOT_ADD_OWN_PRODUCT = 'VENDOR_CANNOT_ADD_OWN_PRODUCT',
}
```

### 3.2 Backend: `cart.service.ts` — Add vendor ownership check in `addItem()`

After the vendor existence validation (after line 53, before "Ensure cart exists"), add:

```typescript
// C3: Vendor cannot add their own products to the cart
const personVendor = await this.vendorRepo.findByPersonId(consumerId);
if (personVendor && product.vendorId === personVendor.id) {
  throw new Error(CartError.VENDOR_CANNOT_ADD_OWN_PRODUCT);
}
```

Full context in `addItem()` method, after line 53 (vendor exists check) and before line 55 (ensure cart exists):

```typescript
async addItem(consumerId: string, productId: string, quantity: number): Promise<Cart> {
    // Validate quantity
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error(CartError.INVALID_QUANTITY);
    }

    // Validate product exists
    const product = await this.productRepo.findById(productId);
    if (!product) {
      throw new Error(CartError.PRODUCT_NOT_FOUND);
    }

    if (!product.isAvailable) {
      throw new Error(CartError.PRODUCT_NOT_AVAILABLE);
    }

    // Get vendorId from product
    const vendorId = product.vendorId;

    // Validate vendor exists
    const vendor = await this.vendorRepo.findById(vendorId);
    if (!vendor) {
      throw new Error(CartError.VENDOR_NOT_FOUND);
    }

    // C3: Vendor cannot add their own products to the cart
    const personVendor = await this.vendorRepo.findByPersonId(consumerId);
    if (personVendor && product.vendorId === personVendor.id) {
      throw new Error(CartError.VENDOR_CANNOT_ADD_OWN_PRODUCT);
    }

    // Ensure cart exists - auto-create if missing (consistent with repository and getCart)
    let cart = await this.cartRepo.findById(consumerId);
    if (!cart) {
      cart = Cart.create(consumerId);
      await this.cartRepo.save(cart);
    }

    return this.cartRepo.addItem(
      consumerId,
      productId,
      vendorId,
      quantity,
      product.price,
      product.quantity
    );
}
```

### 3.3 Backend: `cart.routes.ts` — Handle new error in POST /cart/items

Add handling for `CartError.VENDOR_CANNOT_ADD_OWN_PRODUCT` in the error switch (around line 101-124):

```typescript
case CartError.VENDOR_CANNOT_ADD_OWN_PRODUCT:
  return res.status(403).json({ 
    error: CartError.VENDOR_CANNOT_ADD_OWN_PRODUCT, 
    message: 'Vendedores não podem adicionar produtos da própria loja ao carrinho' 
  });
```

### 3.4 Frontend: `ProductDetailPage.tsx` — Add vendor check in `handleAddToCart`

In the `handleAddToCallback`, add a check before the mutation. Import `PersonRole` from the auth provider:

```typescript
import { useAuth } from '@/app/providers/AuthProvider';

// In handleAddToCart callback, before the try block:
const { user, isAuthenticated } = useAuth();
const isVendor = isAuthenticated && user?.roles?.includes(PersonRole.VENDOR);

// Then in the try block, check:
if (isVendor && product?.vendorId === user?.vendorId) {
  setCartError('Vendedores não podem adicionar produtos da própria loja ao carrinho');
  return;
}
```

Actually, the frontend check needs the person's vendor ID. We can get this from `vendorRepo.findByPersonId(personId)` but that's backend. On the frontend, we can:

1. Store the vendor ID from the user profile / JWT
2. Or make a API call to get the vendor info
3. Or simply show a generic message for vendors trying to add their own products

Simpler approach: The frontend can check if the user has the VENDOR role, and if so, show a disabled button with an explanatory message. The exact comparison (product.vendorId === userVendorId) can be done on the backend as the source of truth, but the frontend can provide early UX feedback.

Let me reconsider the frontend approach. The cleanest way:

In `ProductDetailPage.tsx`, the `handleAddToCart` already has error handling for various status codes. I'll add a specific check:

```typescript
const handleAddToCart = useCallback(async () => {
    if (!product || isOutOfStock) return;

    // C3: Frontend early check for vendors adding own products
    const { user, isAuthenticated } = useAuth();
    if (isAuthenticated && user?.roles?.includes(PersonRole.VENDOR)) {
      // Show message that vendors can't add their own products
      setCartError('Vendedores não podem adicionar produtos da própria loja ao carrinho');
      return;
    }

    // ... rest of the function
});
```

Wait, but this would prevent the API call entirely. A better approach is to let the API handle it (since it's the source of truth), but show the error message from the API response. The frontend can still provide a better UX by disabling the button and showing a pre-emptive message.

Actually, re-reading the requirements more carefully:

> **Frontend validation:**
> - Where to add the check? In the add-to-cart component or API call
> - Show explanatory message to the user

The frontend should show an explanatory message. The best approach:

1. **Backend** validates and returns 403 with error message (source of truth)
2. **Frontend** detects the 403 error and shows the message
3. **Frontend can also** proactively check and disable the button for UX

Let me refine the frontend approach:

In `ProductDetailPage.tsx`, modify `handleAddToCart` to not early-return on vendor check, but instead let the API handle it and show the proper error message. The current error handling already covers 403:

```typescript
if (status === 401 || status === 403) {
  setCartError('Please log in to add items to your cart');
}
```

I need to update this to show the specific vendor message:

```typescript
if (status === 401 || status === 403) {
  setCartError(errorWithStatus.code === 'VENDOR_CANNOT_ADD_OWN_PRODUCT'
    ? 'Vendedores não podem adicionar produtos da própria loja ao carrinho'
    : 'Please log in to add items to your cart');
}
```

But wait - the frontend would need to know the error code. Looking at `CartApiException`:
```typescript
export class CartApiException extends Error {
  public readonly status: number;
  public readonly code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'CartApiException';
    this.status = status;
    this.code = code;
  }
}
```

And in `handleResponse`:
```typescript
throw new CartApiException(
  errorData.message || `API error: ${response.status}`,
  response.status,
  errorData.error
);
```

So the `code` field would be `errorData.error`, which in the routes would be `CartError.VENDOR_CANNOT_ADD_OWN_PRODUCT`. Yes, this works.

Actually, let me simplify. The cleanest frontend approach is:

1. Don't add a proactive vendor check in the frontend `handleAddToCart` (let the backend be the source of truth)
2. Update the error handling in the catch block to recognize the new error code and show the proper message
3. Optionally, add a disabled state on the "Add to Cart" button when the user is a vendor, with a tooltip/explanatory text

Let me go with this approach:

**Frontend changes in `ProductDetailPage.tsx`**:

Update the error handling in `handleAddToCart` to recognize the vendor error:

```typescript
if (status === 401 || status === 403) {
  setCartError(errorWithStatus.code === 'VENDOR_CANNOT_ADD_OWN_PRODUCT'
    ? 'Vendedores não podem adicionar produtos da própria loja ao carrinho'
    : 'Please log in to add items to your cart');
}
```

Also, add a proactive UX check to disable the button for vendors (but still allow the API call - the backend will reject it):

Actually, re-reading the requirement: "Show explanatory message to the user". This could mean either:
- Proactive message before attempting (UX)
- Message after the API rejects (feedback)

I'll do both:
1. Proactive: Disable the "Add to Cart" button for vendors with a tooltip message
2. Reactive: Show the API error message if somehow the backend check is bypassed

Wait, but if I disable the button for vendors, that's a UX improvement but the backend must still validate. Let me implement the proactive check but make it minimal - just disable the button and show a message, without blocking the API call.

Actually, the simplest and safest approach:

1. **Backend**: Add the validation in `addItem()` - this is the core fix
2. **Frontend**: Update error handling to display the proper message when the backend rejects the action
3. **Frontend optional**: Add a disabled state on the button for vendors with an explanatory message

Let me implement the minimal frontend change: just update the error handling.

### 3.5 Frontend: `useCart.ts` — No changes needed (the error handling is in the component)

Actually, the `useAddItem` mutation in `useCart.ts` just calls `cartApi.addItem(input)` and returns the result. The error handling is in the component that uses the mutation (`ProductDetailPage`). So no changes needed in `useCart.ts`.

### 3.6 Test Considerations

**Unit tests for `cart.service.ts`**:
- Add a test case: "Vendor cannot add their own product to cart"
- Test data: person with vendor, product with matching vendorId, addItem should throw
- Test data: person without vendor (consumer only), product addition should succeed
- Test data: person with VENDOR role but no vendor record (edge case) - should allow addition

**Integration tests**:
- End-to-end test: login as vendor, try to add own product to cart, expect 403
- End-to-end test: login as consumer (non-vendor), add product to cart, expect success
- End-to-end test: login as vendor, add other vendor's product to cart, expect success

**Existing tests**:
- `cart.service.test.ts` - may need updating if test data includes vendor products
- `cart.routes.test.ts` - may need updating for new error case

---

## 4. Acceptance Criteria Checklist

### Backend

- [ ] `CartError.VENDOR_CANNOT_ADD_OWN_PRODUCT` added to `cart.domain.ts` enum
- [ ] `cart.service.ts` `addItem()` method checks if `product.vendorId === vendorRepo.findByPersonId(consumerId)?.id`
- [ ] If match found, throws `CartError.VENDOR_CANNOT_ADD_OWN_PRODUCT`
- [ ] `cart.routes.ts` handles the new error with 403 status and explanatory message
- [ ] Validation integrates with CD-059 ownership pattern (same vendorId comparison logic)
- [ ] Validation works for both authenticated (JWT) and guest carts (guest has no vendor, so check passes)
- [ ] Backend is source of truth — direct API calls are also blocked

### Frontend

- [ ] Error handling in `ProductDetailPage.handleAddToCart` recognizes `VENDOR_CANNOT_ADD_OWN_PRODUCT` code
- [ ] User sees message: "Vendedores não podem adicionar produtos da própria loja ao carrinho" (or English equivalent)
- [ ] User can still add products from OTHER vendors' stores (different vendorId)
- [ ] A person with both CONSUMER and VENDOR roles cannot add their OWN products to cart
- [ ] A person with only CONSUMER role can add any products (including from any vendor)

### Behavior

- [ ] Vendor CAN add products from OTHER lojas (different vendorId) to cart ✓
- [ ] Vendor CANNOT add products from THEIR OWN loja (matching vendorId) to cart ✓
- [ ] Checkout with incompatible products fails with clear message (follow-up: may need checkout.service validation)
- [ ] Person acting as both Consumer and Vendor: can buy from other lojas, cannot buy from own loja
- [ ] Direct API calls (bypassing frontend) are blocked by backend validation

### Integration with CD-059

- [ ] Uses same vendorId comparison pattern as `product.service.ts`
- [ ] Consistent with existing ownership validation infrastructure
- [ ] Does not duplicate CD-059 logic but adapts it for the cart context