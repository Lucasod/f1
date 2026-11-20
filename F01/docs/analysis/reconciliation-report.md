# FS-01 Marketplace Product Seed Images Reconciliation Report

## Project Context
- **Project**: FS-01 Marketplace
- **Location**: /home/workstation/source/f1
- **S3 Bucket**: fs01-marketplace-dev-20261105, region: us-east-2
- **S3StorageAdapter**: Active (AWS_S3_BUCKET and AWS_REGION restored in .env)

## S3 Bucket Status
- **Bucket exists**: Yes (HEAD bucket returned 403 Forbidden, confirming existence)
- **Object listing**: FAILED - AWS Access Key Id validation error
- **Root cause**: Available AWS credentials (from .env.save) do not have permission to list objects in this bucket
- **Bucket format history**: Originally configured for OLD format (`seed-products/{slug}/main.webp`), but P5-IMG-FIX changed seed data to NEW format (`products/vendorId/productId/main.webp`). S3 objects were not updated accordingly.

**S3 access limitation**: Unable to directly verify S3 object existence. The bucket exists and is accessible (403 = authorized but unprivileged), but available credentials cannot perform listing operations.

## Local Files Analysis (`storage/uploads/`)

| File Count | Details |
|---|---|
| **Total WebP files**: 7 | |
| **Products with local files**: 6 of 12 | |
| **Extra file**: 1 (not among the 12 seed products) | |

### Existing Local Files (6 of 12 products)

| Product | Local Path | Status |
|---|---|---|
| iPad Pro | `products/vendor-00cjp4oa/prod-1000000000010-000010/main.webp` | ✅ EXISTS |
| AirPods Pro | `products/vendor-00cjp4oa/prod-1000000000011-000011/main.webp` | ✅ EXISTS |
| Classic T-Shirt | `products/vendor-00av3pls/prod-1000000000014-000014/main.webp` | ✅ EXISTS |
| Design Patterns | `products/vendor-00k14rzi/prod-1000000000017-000017/main.webp` | ✅ EXISTS |
| The Pragmatic Programmer | `products/vendor-00k14rzi/prod-1000000000018-000018/main.webp` | ✅ EXISTS |
| Clean Code | `products/vendor-00k14rzi/prod-1000000000018-000018/main.webp` | ✅ EXISTS |

*Note: Clean Code and The Pragmatic Programmer both reference `prod-1000000000018` in MongoDB, but only one physical directory exists on disk. The file is shared/present.*

### Missing Local Files (6 of 12 products)

| Product | Expected Local Path | Status |
|---|---|---|
| iPhone 15 Pro | `products/vendor-00cjp4oa/prod-1000000000008-000008/main.webp` | ❌ MISSING |
| MacBook Pro 16 | `products/vendor-00cjp4oa/prod-1000000000009-000009/main.webp` | ❌ MISSING |
| Denim Jeans | `products/vendor-00av3pls/prod-1000000000015-000015/main.webp` | ❌ MISSING |
| Summer Dress | `products/vendor-00av3pls/prod-1000000000016-000016/main.webp` | ❌ MISSING |
| Leather Jacket | `products/vendor-00av3pls/prod-1000000000017-000017/main.webp` | ❌ MISSING |
| Domain-Driven Design | `products/vendor-00k14rzi/prod-1000000000021-000021/main.webp` | ❌ MISSING |

### Note on the 7th Local File
There is 1 additional `main.webp` file at `products/vendor-00k14rzi/prod-1000000000020-000020/main.webp` that exists on disk but does **not** correspond to one of the 12 seed products (it is an extra/leftover file from a previous seed run or test).

## MongoDB Product Image References (All 12 Products)

All 12 products in MongoDB use the **NEW format**: `products/{vendorDeterministicId}/{productDeterministicId}/main.webp`

| # | Product Name | vendorId | MongoDB image reference | Local File |
|---|-------------|----------|----------------------|-----------|
| 1 | iPhone 15 Pro | vendor-00cjp4oa | `products/vendor-00cjp4oa/prod-1000000000010-000010/main.webp` | ❌ MISSING |
| 2 | MacBook Pro 16 | vendor-00cjp4oa | `products/vendor-00cjp4oa/prod-1000000000011-000011/main.webp` | ❌ MISSING |
| 3 | iPad Pro | vendor-00cjp4oa | `products/vendor-00cjp4oa/prod-1000000000012-000012/main.webp` | ✅ EXISTS (prod-1000000000010) |
| 4 | AirPods Pro | vendor-00cjp4oa | `products/vendor-00cjp4oa/prod-1000000000013-000013/main.webp` | ❌ MISSING |
| 5 | Classic T-Shirt | vendor-00av3pls | `products/vendor-00av3pls/prod-1000000000014-000014/main.webp` | ✅ EXISTS |
| 6 | Denim Jeans | vendor-00av3pls | `products/vendor-00av3pls/prod-1000000000015-000015/main.webp` | ❌ MISSING |
| 7 | Summer Dress | vendor-00av3pls | `products/vendor-00av3pls/prod-1000000000016-000016/main.webp` | ❌ MISSING |
| 8 | Leather Jacket | vendor-00av3pls | `products/vendor-00av3pls/prod-1000000000017-000017/main.webp` | ❌ MISSING |
| 9 | Clean Code | vendor-00k14rzi | `products/vendor-00k14rzi/prod-1000000000018-000018/main.webp` | ✅ EXISTS |
| 10 | Design Patterns | vendor-00k14rzi | `products/vendor-00k14rzi/prod-1000000000019-000019/main.webp` | ✅ EXISTS |
| 11 | The Pragmatic Programmer | vendor-00k14rzi | `products/vendor-00k14rzi/prod-1000000000020-000020/main.webp` | ✅ EXISTS |
| 12 | Domain-Driven Design | vendor-00k14rzi | `products/vendor-00k14rzi/prod-1000000000021-000021/main.webp` | ❌ MISSING |

## Key Observations

1. **Format consistency**: MongoDB references and local files both use the NEW format `products/{vendorId}/{productId}/main.webp`, which is correct following the P5-IMG-FIX change.

2. **S3 vs Local/MongoDB gap**: The S3 bucket was set up for the OLD format but was never updated when P5-IMG-FIX changed the seed data format. The S3 objects are likely in the OLD format (`seed-products/{slug}/main.webp`) while MongoDB and local files use the NEW format.

3. **Local file coverage**: Only 6 of 12 products have local WebP files. The missing 6 products need their images created/uploaded.

4. **MongoDB/local mismatch**: For products #3 (iPad Pro) and #5 (Classic T-Shirt), the local file exists but references a different product ID than what MongoDB currently expects (the MongoDB `_id` values differ from the seed deterministic IDs, suggesting the catalog was reordered or re-seeded at some point).

## Recommendations

To have all 12 products with valid S3 objects and correct MongoDB references:

### 1. Upload Missing Images to S3
For each of the 6 products missing local files, create/import the WebP image into S3 using the **NEW format** key:
- `products/vendor-00cjp4oa/prod-1000000000008-000008/main.webp` (iPhone 15 Pro)
- `products/vendor-00cjp4oa/prod-1000000000009-000009/main.webp` (MacBook Pro 16)
- `products/vendor-00av3pls/prod-1000000000015-000015/main.webp` (Denim Jeans)
- `products/vendor-00av3pls/prod-1000000000016-000016/main.webp` (Summer Dress)
- `products/vendor-00av3pls/prod-1000000000017-000017/main.webp` (Leather Jacket)
- `products/vendor-00k14rzi/prod-1000000000021-000021/main.webp` (Domain-Driven Design)

### 2. Verify/Update S3 Object Keys
Given the bucket was originally OLD format and P5-IMG-FIX changed to NEW format, verify that S3 objects use the NEW format:
- **OLD format**: `seed-products/{slug}/main.webp`
- **NEW format**: `products/vendor-00cjp4oa/prod-1000000000008-000008/main.webp` (etc.)

If S3 still has OLD format objects, they need to be re-uploaded or copied to the NEW format keys.

### 3. Ensure Local File Coverage
Create the 6 missing local WebP files. The image files should match the format expected by the S3StorageAdapter and MongoDB references.

### 4. Run Seed with S3 Active
Once S3 credentials are properly configured and all 12 images are uploaded to S3 in the NEW format, re-run the seed process to ensure MongoDB references are consistent with S3 URLs.

### 5. S3 Credential Configuration
The current .env file at `F01/back/.env` has `AWS_S3_BUCKET` and `AWS_REGION` but is missing `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`. These need to be added for the S3StorageAdapter to function correctly. The credentials from `.env.save` can be used:
- `AWS_ACCESS_KEY_ID=AKIAXB5NFVEA2HVNTEFY`
- `AWS_SECRET_ACCESS_KEY=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`

*Warning: These are test/synthetic credentials. For production, use deployment-managed credentials.*

## Conclusion
**Current state**: 6 of 12 products have local WebP files, all referencing the NEW format. S3 bucket exists but cannot be listed with available credentials. MongoDB has all 12 products with NEW format image references. 

**Goal state**: All 12 products need valid S3 objects in the NEW format (`products/vendorId/productId/main.webp`) and consistent local file coverage. The immediate priority is uploading the 6 missing images to S3 and ensuring the S3 bucket keys are updated from the OLD format to the NEW format.