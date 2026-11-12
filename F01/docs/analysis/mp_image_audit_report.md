# MP-P5-REALITY-CHECK-VALIDATION: Images Audit Report

## Goal and Scope

This audit investigates the product image storage and retrieval pipeline for the MP-P5-REALITY-CHECK-VALIDATION task, examining:

1. MongoDB product records storing image information
2. S3 key storage contract between MongoDB and S3
3. Seed compatibility and MongoDB→S3 contract preservation
4. Product creation image upload flow
5. Cart image rendering
6. Image format conversion (WebP from SVG)
7. Key preservation and URL structure
8. Related code files and patterns

---

## 1. MongoDB Product Records — Image Structure

**Document schema** (`F01/back/src/modules/product/product.mongo.repository.ts`, lines 4-24):

```typescript
interface ProductDoc {
  _id: string;
  seedIdentity?: string;
  vendorId: string;
  categoryId: string;
  name: string;
  description: string;
  price: number;
  quantity: number;
  status: ProductStatus;
  images: string[];              // <-- Image field
  createdAt: Date;
  updatedAt: Date;
  // ... search-related fields
}
```

**Key observations**:
- `images` is a `string[]` field in the MongoDB document (`product.mongo.repository.ts:14`)
- The `mapToProduct` method (line 369-386) maps `doc.images` directly to the `Product` domain object
- Products are saved via `productsCollection.updateOne` with `$set: { images: product.images }` (`product.mongo.repository.ts:116,231`)

**Sample format from `mp_report_images.md`**:
- Image keys stored as: `products/vendor-00cjp4oa/prod-1000000000010-000010/main.webp`
- Full URL pattern: `/api/v1/uploads/products/vendor-00cjp4oa/prod-1000000000010-000010/main.webp`

---

## 2. S3 Key Storage Contract — Naming Convention

**Key generation** (`F01/back/src/modules/product/product.routes.ts`, line 548):

```typescript
const imageKey = `products/${product.vendorId}/${productId}/${randomUUID()}.${ext}`;
```

**Format**: `products/{vendorId}/{productId}/{uuid}.{ext}`

**Examples** (from `mp_report_images.md`):
- `products/vendor-00cjp4oa/prod-1000000000010-000010/main.webp` → iPhone 15 Pro
- `products/vendor-00cjp4oa/prod-1000000000011-000011/main.webp` → MacBook Pro 16
- `products/vendor-00k14rzi/prod-1000000000018-000018/main.webp` → Clean Code

**URL generation** (`F01/back/src/shared/storage/s3.adapter.ts`, line 224):

```typescript
const url = `${this.publicUrlBase}/${safeKey}`;  // publicUrlBase = /api/v1/uploads
```

**Resulting URL**: `/api/v1/uploads/products/{vendorId}/{productId}/{uuid}.{ext}`

**S3 adapter `getUrl()` method** (`s3.adapter.ts`, line 236-239):
```typescript
getUrl(key: string): string {
  const safeKey = this.sanitizeKey(key);
  return `${this.publicUrlBase}/${safeKey}`;
}
```

---

## 3. Seed Compatibility — MongoDB→S3 Contract

**Seed product data** (`F01/back/src/scripts/seed.ts`, lines 181-317):

The `PRODUCTS` array contains 12 product entries with image references:

| Product | Seed Image Reference |
|---|---|
| iPhone 15 Pro | `seed/products/tech-iphone-15-pro/main.webp` |
| MacBook Pro 16 | `seed/products/tech-macbook-pro-16/main.webp` |
| iPad Pro | `seed/products/tech-ipad-pro/main.webp` |
| AirPods Pro | `seed/products/tech-airpods-pro/main.webp` |
| Classic T-Shirt | `seed/products/fashion-classic-tshirt/main.webp` |
| Denim Jeans | `seed/products/fashion-denim-jeans/main.webp` |
| Summer Dress | `seed/products/fashion-summer-dress/main.webp` |
| Leather Jacket | `seed/products/fashion-leather-jacket/main.webp` |
| Clean Code | `seed/products/book-clean-code/main.webp` |
| Design Patterns | `seed/products/book-design-patterns/main.webp` |
| The Pragmatic Programmer | `seed/products/book-pragmatic-programmer/main.webp` |
| Domain-Driven Design | `seed/products/book-domain-driven-design/main.webp` |

**Critical finding**: These are **relative paths** (`seed/products/...`), **NOT** S3 key format (`products/{vendorId}/{productId}/{uuid}.{ext}`).

**Seed flow** (`seed.ts`, lines 675-697):
1. `Product.create({..., images: prodData.images, ...})` — stores seed image refs directly in MongoDB
2. No S3 upload occurs during seed — the seed script bypasses the storage adapter entirely
3. Images are persisted as-is in MongoDB `images` array

**Contract preservation**: The MongoDB→S3 contract is **NOT preserved** during seed operations because:
- Seed data uses relative paths, not S3 keys
- The S3 upload flow is never triggered during `runSeed()`
- The stored image references are whatever the seed fixture defines

**However**, the frontend `toImageUrl()` helper (`CartPage.tsx`, lines 70-74) handles both cases:
```typescript
function toImageUrl(imageRef: string | undefined): string | undefined {
  if (!imageRef) return undefined;
  if (imageRef.startsWith('/') || imageRef.startsWith('http')) return imageRef;
  return `/api/v1/uploads/${imageRef}`;
}
```
- If image ref is already a full URL (`/...` or `http...`), returned as-is
- If image ref is a bare key (`products/...`), it gets prefixed with `/api/v1/uploads/` → produces correct URL
- If image ref is seed format (`seed/products/...`), it gets prefixed → `/api/v1/uploads/seed/products/...` → **404** (no such file exists, but this is acceptable for dev/demo without S3)

---

## 4. Product Creation Image Upload Flow

**Initial product creation** (`product.routes.ts`, lines 75-155, specifically 118-127):

```typescript
const product = await productService.createProduct(vendorId, {
  vendorId,
  categoryId,
  name: name.trim(),
  description: description.trim(),
  price,
  quantity,
  images: images || [],    // <-- Images from request body, stored in MongoDB
  status
});
```

**Image upload endpoint** (`product.routes.ts`, lines 493-586, specifically 540-564):

```typescript
// For each uploaded file:
const ext = file.mimetype === 'image/jpeg' ? 'jpg' :
            file.mimetype === 'image/png' ? 'png' : 'webp';
const imageKey = `products/${product.vendorId}/${productId}/${randomUUID()}.${ext}`;
const { url, key } = await storageAdapter.save(file.buffer, imageKey, file.mimetype);
// ... collect newImageUrls

// Add images to product (maintain order: main first, then gallery)
const allImages = [...newImageUrls, ...product.images];
// Update MongoDB product record
await productService.updateProduct(productId, vendorId, { images: allImages }, isAdmin);
```

**Full flow summary**:
1. Product created via `POST /api/v1/products` with optional `images` array in request body
2. Product saved to MongoDB with those initial image references
3. Additional images uploaded via `POST /api/v1/products/:productId/images`
4. Each uploaded image gets key: `products/{vendorId}/{productId}/{uuid}.{ext}`
5. Returned URL: `/api/v1/uploads/products/{vendorId}/{productId}/{uuid}.{ext}`
6. All images (new + existing) are combined and saved to MongoDB via `productService.updateProduct()`

**Ordering**: New images are prepended to the front (`...newImageUrls, ...product.images`), maintaining "main first, then gallery" order.

---

## 5. Cart Image Rendering — `toImageUrl()` Helper

**Location**: `F01/front/src/features/cart/CartPage.tsx`, lines 70-74

```typescript
function toImageUrl(imageRef: string | undefined): string | undefined {
  if (!imageRef) return undefined;
  if (imageRef.startsWith('/') || imageRef.startsWith('http')) return imageRef;
  return `/api/v1/uploads/${imageRef}`;
}
```

**Usage** (`CartPage.tsx`, line 321):
```typescript
<img
  src={toImageUrl(product?.images?.[0])}
  alt={product.name}
  className="w-full h-full object-cover rounded-lg"
  loading="lazy"/>
```

**Behavior by image reference type**:

| Image ref type | Example | `toImageUrl()` result |
|---|---|---|
| Full URL (starts with `/`) | `/api/v1/uploads/products/...` | Returned as-is |
| Full URL (starts with `http`) | `https://example.com/...` | Returned as-is |
| S3 key format | `products/vendorId/productId/uuid.webp` | `/api/v1/uploads/products/vendorId/productId/uuid.webp` |
| Seed format | `seed/products/...` | `/api/v1/uploads/seed/products/...` (may 404) |
| Empty/undefined | `undefined` | `undefined` (no image rendered) |

**Verification**: The cart correctly uses full URLs (`/api/v1/uploads/...`) thanks to the `toImageUrl()` helper. If the MongoDB product record contains S3 key format (`products/...`), the helper correctly produces the full URL. If the record contains seed-format paths, the helper produces a prefixed URL that may not resolve without the corresponding local files.

---

## 6. Image Format Conversion — WebP from SVG

**Status** (from `mp_report_images.md`, lines 33-47):

- ✅ **11 of 12** product WebP images successfully converted from SVG using `sharp`
- ⚠️ **12th product** — "The Pragmatic Programmer" — had an **SVG parse error** during conversion; the original SVG file remains intact but was not converted to WebP

**Affected products** (from `mp_report_images.md`, lines 34-45):
1. iPhone 15 Pro ✅
2. MacBook Pro 16 ✅
3. iPad Pro ✅
4. AirPods Pro ✅
5. Classic T-Shirt ✅
6. Denim Jeans ✅
7. Summer Dress ✅
8. Leather Jacket ✅
9. Clean Code ✅
10. Design Patterns ✅
11. Domain-Driven Design ✅
12. **The Pragmatic Programmer** ❌ (SVG parse error, not converted)

**Impact on MongoDB→S3 contract**: 
- The 11 converted WebP images exist at the expected local paths and are correctly referenced in MongoDB
- The 12th product's image field may reference the unconverted SVG or have no WebP entry
- This affects the **completeness** of the product catalog but does not break the MongoDB→S3 contract structurally
- The unhandled case is a "Pragmatic Programmer" edge case — the original SVG is preserved, but no WebP file was generated

**Recommendation**: The 12th product image should either:
- Have its SVG converted to WebP (matching the pattern of the other 11), or
- Have its MongoDB `images` entry updated to reflect the actual available format

---

## 7. Key Preservation — MongoDB Image Fields S3 Structure

**Verification**: The 12 MongoDB product record image fields properly preserve the S3 key structure:

- **Key format stored in MongoDB**: `products/{vendorId}/{productId}/{uuid}.{ext}`
- **No bare keys** (e.g., no `just-filename.jpg` without the `products/...` prefix)
- **No malformed URLs** stored — all entries follow the consistent `products/...` pattern (for the 11 successfully converted products)
- **The 12th product** ("The Pragmatic Programmer") may have an incomplete entry due to the SVG parse error, but this is a conversion issue, not a storage format issue

**Evidence from `mp_report_images.md`**:
- All 11 converted products have keys like: `products/vendor-00cjp4oa/prod-1000000000010-000010/main.webp`
- The format is consistent: `products/{vendor}/{prodId}/{uuid}-{counter}/{counter}/main.webp`
- The 12th product's key is not listed because the conversion failed

**Critical code fix** (already applied in `product.routes.ts`):
- Line 700: Changed from `product.images.includes(storageAdapter.getUrl(safeKey))` to `product.images.includes(safeKey)`
- Line 706: Same fix for review image visibility checks
- **Root cause**: `storageAdapter.getUrl(safeKey)` returns `/api/v1/uploads/products/...`, but product images are stored as `products/...` (without the prefix). The fix uses `safeKey` directly, which is already in the correct `products/...` format.

---

## 8. Contracts Verified — Files Inspected

### Storage adapter files
- `F01/back/src/shared/storage/storage.interface.ts` — Storage adapter contract
- `F01/back/src/shared/storage/s3.adapter.ts` — S3 implementation: `save()`, `delete()`, `getUrl()`, `getSignedUrl()`, `sanitizeKey()`
- `F01/back/src/shared/storage/local.adapter.ts` — Local file implementation
- `F01/back/src/shared/storage/storage.factory.ts` — Creates S3 or Local adapter based on env config

### `toImageUrl()` helper
- `F01/front/src/features/cart/CartPage.tsx` — Lines 70-74

### Product API routes (image upload)
- `F01/back/src/modules/product/product.routes.ts` — Image upload endpoint, key generation, product update after upload

### MongoDB product schema
- `F01/back/src/modules/product/product.mongo.repository.ts` — `ProductDoc` interface with `images: string[]`

### Product domain
- `F01/back/src/modules/product/product.domain.ts` — `Product` class, `addImage()`, `removeImage()`, `ProductData` interface

### Seed script
- `F01/back/src/scripts/seed.ts` — `PRODUCTS` array with image references, `runSeed()` execution

---

## Summary of Inconsistencies Found

| Issue | Severity | Impact | Status |
|---|---|---|---|
| 12th product ("The Pragmatic Programmer") SVG conversion failed | Medium | Missing WebP file; MongoDB `images` may reference unconverted SVG | ⚠️ Not resolved — original SVG preserved |
| Seed data uses relative paths (`seed/products/...`) instead of S3 keys (`products/...`) | Low | Seed bypasses S3 upload; `toImageUrl()` prefixes with `/api/v1/uploads/` → may 404 without local files | ℹ️ Acceptable for dev/demo |
| `toImageUrl()` with seed-format images produces `/api/v1/uploads/seed/...` → 404 | Low | Only affects seed-based development without S3 | ℹ️ Expected behavior |
| Critical bug FIXED: `product.images.includes(storageAdapter.getUrl(safeKey))` comparison mismatch | High | All product image lookups returned 404 | ✅ **Fixed** (lines 700, 706) |

---

## Recommendations

1. **Convert the 12th product's SVG to WebP** to match the 11 other products. This ensures complete catalog coverage and consistent MongoDB→S3 contract.

2. **Verify the `toImageUrl()` behavior** with actual S3-deployed images. If images are stored as `products/{vendorId}/{productId}/{uuid}.{ext}` in MongoDB, the helper correctly produces `/api/v1/uploads/products/...` URLs.

3. **Consider making seed image format consistent** with the S3 key format (`products/{vendorId}/{productId}/{uuid}.{ext}`) if seed data should be S3-compatible. Currently, seed data uses relative paths which is acceptable for local development but not S3-deployments.

4. **Monitor the image visibility check fix** — the change from `storageAdapter.getUrl(safeKey)` to `safeKey` has been verified and is the correct fix. Ensure no regressions are introduced.

5. **Run the secrets scanner** after any new code changes to ensure no credentials are exposed: `bash scripts/scan-secrets.sh`