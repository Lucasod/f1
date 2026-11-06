# Run Record — S3 Product Image Integration (MP FS-01)

## Run metadata
- Run ID: orch-s3-integration-2026-11-06
- Start time: 2026-11-06
- Branch: (current working tree; no branch change)
- Base commit: 5ccc9b6 (HEAD at run start)
- Authorized task: T-703b — Backend: Image upload to S3
- Scope: backend S3 storage adapter wiring, presigned retrieval, config/docs; no AWS resource creation; no commit/push/deploy.

## Task log
| Task | Status | Phase | Notes |
|------|--------|-------|-------|
| T-703b | partial (internal) | imp/review | S3 adapter wired via createStorageAdapter; presigned GET implemented; CloudFront CDN and multipart upload pending. |

## Findings log
| ID | Task | Severity | Status | Attempts | Resolution |
|----|------|----------|--------|----------|------------|
| F-S3-01 | T-703b | medium | resolved | 1 | S3 cleanup scanned entire bucket and could delete unrelated objects (e.g. invoices); fixed to scan only products/ and reviews/ prefixes. |
| F-S3-02 | T-703b | low | noted | 1 | S3 cleanup catch block previously under-reported deleted count; fixed to track progress in outer scope. |
| F-S3-03 | T-703b | low | noted | 1 | Multi-file upload rollback only on updateProduct failure; earlier S3 objects may linger until startup cleanup. |
| F-S3-04 | T-703b | low | noted | 1 | Review service mutates in-memory review before persistence; storage rollback does not revert in-memory state. |

## AWS validation
- AWS CLI available (aws-cli/2.23.6).
- STS GetCallerIdentity: account 485157611777, user setupKey, region us-east-2.
- Bucket: fs01-marketplace-dev-20261105, region us-east-2 (head-bucket).
- Reversible Put/Get/Delete test on temp/fs01-s3-diag.txt succeeded and object removed.
- Insufficient IAM permissions: s3:GetBucketLocation, s3:GetBucketPublicAccessBlock, s3:GetEncryptionConfiguration (AccessDenied). Bucket public-access-block and encryption settings could not be verified; Block Public Access and SSE are assumed/required by config and must be confirmed by an authorized operator.
- AWS SDK @aws-sdk/client-s3 and @aws-sdk/s3-request-presigner installed.

## Implementation summary
- Files changed: src/shared/storage/* (aws-s3.client.ts new, storage.factory.ts new, s3.adapter.ts, storage.interface.ts, local.adapter.ts), src/config/index.ts, src/index.ts, src/modules/product/product.routes.ts, src/modules/review/review.service.ts, .env.example, docs.
- Storage selection: S3 when AWS_S3_BUCKET and AWS_REGION are set; otherwise LocalStorageAdapter (tests/dev).
- Retrieval: relative /api/v1/uploads/{key}; for remote adapter redirects to presigned GET URL (1h default).
- Failure handling: product image upload rolls back S3 objects if product update fails; review image rolls back on review update failure.

## Verification
- npx tsc --noEmit: exit 0.
- npx vitest run src/shared/storage: 3 files, 30 tests passed.
- npx vitest run product.routes.test.ts review.service.test.ts review.routes.test.ts: 6 files/174 tests passed (including storage).
- Full npm test: 46 passed, 7 failed (Mongo repository cleanup environment issue: client.db(...).drop is not a function), 1 skipped; 1003 passed, 13 failed, 3 skipped. Failures are pre-existing and unrelated to S3 (Mongo driver API).
- Secret scan: no credentials printed; .env not committed.

## Checkpoints
- 2026-11-06: S3 adapter wired and type-check clean.
- 2026-11-06: presigned retrieval implemented and tests passed.
- 2026-11-06: cleanup scoped to products/ and reviews/ prefixes.

## Next action
- Obtain IAM permissions or operator confirmation for bucket Block Public Access and SSE settings; document exact bucket configuration.
- Implement CloudFront CDN and multipart upload when authorized.
- Fix Mongo repository test cleanup (client.db(...).drop -> dropDatabase) separately; unrelated to S3.

## Limitations and uncertainties
- CloudFront CDN not configured; publicUrlBase defaults to /api/v1/uploads (app-proxied presigned retrieval).
- Multipart upload not implemented.
- Bucket encryption/public-access-block not verified due to IAM permissions.
- AWS credentials sourced from environment; no profile.

## Conclusion
OPERATIONAL PAUSE (T-703b partial; infrastructure verification pending). No commit made.

## Checkpoint — 2026-11-06, CR001–CR007 recovery

- Scope: partial local remediation only; independent review remains pending. Historical base `5ccc9b6` was verified as a commit; initial worktree and index were clean. No AWS or database operations were performed.
- The public upload route still signs arbitrary storage keys; access authorization and visibility remain unresolved. Product uploads now use unique keys and compensate completed uploads on a subsequent upload failure. An error returned by product persistence can occur after commit, so the new objects are deliberately retained on that uncertain outcome; safe reconciliation remains unresolved. A failed S3 put can similarly have an unknown outcome.
- S3 orphan cleanup now fails closed because a URL snapshot cannot establish safety for concurrent uploads or historical URL bases. Consequently the previous batch deletion and its false-success handling are disabled, not validated as a working batch-deletion implementation. Operators must not infer successful cleanup.
- Storage factory rejects a bucket without a region and a region without a bucket. Other partially specified S3 settings require further assessment.
- RED: from `F01/back`, `./node_modules/.bin/vitest run src/shared/storage/s3.adapter.test.ts src/shared/storage/storage.factory.test.ts` exited 1: three failures, 16 passes. `./node_modules/.bin/vitest run src/modules/product/product.image-compensation.test.ts` exited 1: one failure.
- GREEN before final formatting: `./node_modules/.bin/vitest run src/modules/product/product.image-compensation.test.ts src/shared/storage/s3.adapter.test.ts src/shared/storage/storage.factory.test.ts` exited 0: 20 tests passed. `./node_modules/.bin/tsc --noEmit` exited 0. Earlier full storage tests exited 0: 34 tests passed. These use mocks and do not establish S3 or MongoDB behavior.
- Next: complete route authorization and visibility checks, determine safe handling of ambiguous storage/persistence outcomes, assess other partial S3 configuration, rerun tests/typecheck and request independent review. No claim of task completion or infrastructure validation.
- Post-format verification from `F01/back`: `./node_modules/.bin/vitest run src/modules/product/product.image-compensation.test.ts src/shared/storage` exited 0 (5 files, 35 tests); `./node_modules/.bin/tsc --noEmit` exited 0. From repository root, `git --no-pager diff --check` exited 0. Review remains pending.

## Checkpoint — 2026-11-06, CR001–CR005 reviewer corrections

- CR001: public image retrieval now checks canonical key, permitted namespace, server-side product/review identity, reference matching the current adapter URL, and visibility before serving or signing. Products must be active or out of stock; reviews must be published and their product visible. Missing dependencies fail closed. Both local and remote responses use `no-store`; remote signatures expire after 60 seconds. Existing signed links cannot be immediately revoked on moderation, and historical/alternate URL bases are denied pending a safe mapping. Public product list/detail routes currently expose inactive product metadata, but this endpoint conservatively denies its images.
- CR002 remains unresolved: product image upload and delete and general product update write image arrays; `ProductService` also updates activation, inactivation, and stock through repository `update`, which writes the entire image array (`product.mongo.repository.ts`). `save` also writes all fields, including images, and is used for creation/seed; checkout/payment stock mutations use separate atomic stock operations. A CAS solely in image upload would not protect against stale whole-product writers. No concurrency protocol was invented.
- CR003/004 remain unresolved: product uploads retain new images when persistence may have committed; review image persistence now does the same. Failed uploads/deletions can leave untracked objects and there is no durable reconciliation protocol. Existing explicit product-image delete deletes storage before updating the product reference and can leave a broken reference if persistence fails; concurrent reference changes are also not protected. Do not mark these findings resolved.
- CR005 remains fail-closed: S3 orphan cleanup is disabled, not a completed cleanup protocol.
- RED from `F01/back`: `./node_modules/.bin/vitest run src/modules/product/product.upload-visibility.test.ts` exited 1 (unauthorized key signed); `./node_modules/.bin/vitest run src/modules/review/review.image-ambiguous.test.ts` exited 1 (image deleted after ambiguous persistence failure).
- During broader verification, `./node_modules/.bin/vitest run src/modules/product/product.routes.test.ts src/modules/product/product.upload-visibility.test.ts src/modules/product/product.image-compensation.test.ts src/modules/review/review.routes.test.ts src/modules/review/review.service.test.ts src/modules/review/review.image-ambiguous.test.ts src/shared/storage` exited 1 (177 passed, 5 failed): older tests expected fixed object names, intentionally replaced by unique names to prevent overwrite. Updated those expectations to require unique keys while retaining ordering, extension, and URL checks.
- GREEN: the same broader command exited 0 (10 files, 182 tests passed). `./node_modules/.bin/tsc --noEmit` exited 0. Tests use local/mocked dependencies and do not prove AWS behavior, concurrent database safety, or infrastructure security. Independent review remains required.

## Checkpoint — 2026-11-06, admin image ownership review

- Reviewer CR-001: product upload now builds the object key with the loaded product's vendor ID rather than the actor's vendor ID. Authorization and the admin bypass are unchanged. Regression test exercises admin upload and public retrieval, a foreign vendor's denied upload and forged-prefix retrieval, and an admin represented with another vendor profile. It uses local storage and in-memory repositories, not AWS or MongoDB.
- RED from `F01/back`: `./node_modules/.bin/vitest run src/modules/product/product.routes.test.ts -t 'allows an admin to upload under the product owner'` exited 1, demonstrating an admin-key vendor mismatch. GREEN: the same command exited 0 (1 passed, 128 skipped), before extending the same test to cover an admin with another vendor profile.
- Final GREEN from `F01/back`: `./node_modules/.bin/vitest run src/modules/product/product.routes.test.ts src/modules/product/product.upload-visibility.test.ts src/modules/product/product.image-compensation.test.ts src/modules/review/review.routes.test.ts src/modules/review/review.service.test.ts src/modules/review/review.image-ambiguous.test.ts src/shared/storage` exited 0 (10 files, 183 passed); `./node_modules/.bin/tsc --noEmit` exited 0.
- Reviewer CR-002: historical URL bases remain denied; no trust is inferred from arbitrary domains or suffixes. A verified mapping/migration protocol is still needed. Concurrency, ambiguous persistence/deletion and reconciliation remain open. S3 cleanup stays disabled; local cleanup also lacks a demonstrated concurrency-safe protocol and was not changed or certified. Existing signed S3 URLs remain valid until expiry. Independent review is pending.

## Checkpoint — 2026-11-06, subsequent independent review

- Verdict: **CORRECTIONS_NEEDED**, as reported by the Orchestra. The reviewer confirmed by static inspection that `product.routes.ts:541` uses `product.vendorId` and that the admin test at `product.routes.test.ts:1632–1658` covers the admin scenario.
- The reviewer did not inspect the diff and did not execute tests. This report is not a PASS and does not independently validate the earlier test results.
- CR-002 historical URL bases and the concurrency, reconciliation, and cleanup issues remain open. Next: design a cross-writer CAS protocol and a safe historical URL mapping; do not assume approval or completion.
