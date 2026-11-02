# Review Moderation & Display Analysis — T-117 / Q-017

> Historical analysis snapshot. MP-08 resolved Q-017 in CD-067..CD-072. Any pending-decision labels and PAID-state suggestions below are superseded: reviews publish immediately, Admin may hide/reject them, rating is 1-5 with arithmetic-mean aggregation, and eligibility requires a DELIVERED order. Owned review images are implemented with temporary local storage; the S3 adapter remains a separate future integration.

## Context

**Confirmed (CD-017):**
- A review can only be made by someone who purchased the product
- Review creation requires link to completed Order_Item

**Dependencies (per Q-017):**
- CD-017: Verified purchase requirement
- CD-023: Order_Item keeps historical unit price

**Functional Requirement (FR-RW-001):**
- Review creation allowed for consumers with completed purchase (Order_Item with Order in PAID state or beyond)
- Review submission rejected for consumers without purchase
- Note: Exact qualifying state (PAID vs DELIVERED) pending Q-017 resolution

**State at time of this analysis:** PARTIALLY_RESOLVED. Q-017 is now RESOLVED by CD-067..CD-072.

---

## Historical Options (Resolved by CD-067..CD-072)

### 1. Moderation Policy

#### Option A: Post-Moderation (Recommended for MVP)
**Description:** Reviews published immediately upon creation. Admin can hide/remove inappropriate content retroactively.

**Pros:**
- Lower friction for consumers (instant publishing)
- Simpler implementation (no approval queue)
- Higher review volume (trust signal)
- Admin tools for abuse handling (aligns with CD-041 vendor suspension model)

**Cons:**
- Inappropriate content temporarily visible
- Requires admin monitoring/reporting system
- Potential for spam/fake reviews before detection

**Implementation:**
- Review.status = `published` by default
- Admin can change to `hidden` or `rejected`
- Consumer can report reviews
- Vendor can flag for admin attention

#### Option B: Pre-Moderation
**Description:** All reviews require admin approval before publication.

**Pros:**
- No inappropriate content ever published
- Higher content quality guarantee

**Cons:**
- High friction (delayed publishing)
- Admin bottleneck (scales poorly)
- Lower review volume
- Not aligned with CD-041 auto-publish philosophy

#### Option C: Hybrid — Post-Moderation with Auto-Filtering
**Description:** Immediate publishing + automated profanity/spam filtering + admin review queue for flagged content.

**Pros:**
- Balances speed and safety
- Reduces admin workload

**Cons:**
- Additional implementation complexity
- False positives/negatives in auto-filter

**Recommendation:** **Option A (Post-Moderation)** — Aligns with CD-041 (auto-publish for vendors), MVP simplicity, and CD-055 (manual refresh MVP, no real-time infrastructure). Admin tools for abuse handling can be built incrementally.

**Business Decision Required:** Yes — moderation policy is a business/trust decision.

---

### 2. Vendor Response to Reviews

#### Option A: Single Response per Review (Recommended)
**Description:** Vendor can post one public response per review. Response is visible alongside review.

**Pros:**
- Addresses concerns publicly
- Shows vendor engagement
- Simple to implement (one response field per review)
- Aligns with standard marketplace patterns (Amazon, Mercado Livre)

**Cons:**
- No back-and-forth dialogue
- Vendor cannot update response

#### Option B: No Vendor Response
**Description:** Vendors cannot respond to reviews.

**Pros:**
- Simpler model
- Avoids potential disputes in public

**Cons:**
- Misses trust-building opportunity
- Standard expectation in Brazilian marketplaces

#### Option C: Threaded Conversation
**Description:** Multiple exchanges between consumer and vendor.

**Pros:**
- Full dialogue

**Cons:**
- Complex implementation
- Can escalate disputes publicly
- Not typical for product reviews

**Recommendation:** **Option A (Single Response)** — Standard pattern, builds trust, simple implementation.

**Business Decision Required:** Yes — vendor response capability affects trust signals and dispute dynamics.

---

### 3. Verified Purchase Badge

#### Option A: Badge on Review (Recommended)
**Description:** Visual indicator ("Verified Purchase") shown on reviews from confirmed buyers.

**Pros:**
- Strong trust signal
- Differentiates from unverified reviews (if any future change)
- Standard in Brazilian e-commerce

**Cons:**
- Minimal (already guaranteed by CD-017)

#### Option B: No Explicit Badge
**Description:** All reviews are verified purchases by design; no badge needed.

**Pros:**
- Cleaner UI
- CD-017 already guarantees verification

**Cons:**
- Misses explicit trust signal consumers expect
- No visual differentiation if policy changes

**Recommendation:** **Option A (Badge)** — Low cost, high trust value, standard UX pattern. Even though CD-017 guarantees verification, explicit badge reinforces trust.

**Business Decision Required:** Yes — UX/trust decision.

---

### 4. Rating Aggregation Method

#### Option A: Simple Arithmetic Mean (Recommended)
**Description:** Average of all rating values (1-5 scale).

**Pros:**
- Simple, transparent
- Industry standard
- Easy to understand

**Cons:**
- Vulnerable to outliers
- Doesn't weight recent vs old reviews

#### Option B: Bayesian Average / Weighted Rating
**Description:** Adjusts for review count (e.g., IMDb formula: `(v ÷ (v+m)) × R + (m ÷ (v+m)) × C`)

**Pros:**
- More stable for products with few reviews
- Reduces impact of small sample sizes

**Cons:**
- Less transparent
- Complexity not justified for MVP

#### Option C: Time-Weighted / Recency Bias
**Description:** Recent reviews weighted higher.

**Pros:**
- Reflects current product quality

**Cons:**
- Complexity
- Less transparent

**Recommendation:** **Option A (Simple Mean)** — MVP simplicity. Can evolve to Bayesian if review volume justifies it.

**Additional Decision:** Rating scale — **1 to 5 stars** (standard, not explicitly decided but implied by "Rating" attribute).

**Business Decision Required:** Yes for rating scale; aggregation method can default to simple mean with note for future enhancement.

---

### 5. Review Eligibility State (Refining CD-017 / FR-RW-001)

**Historical source text:** FR-RW-001 previously used PAID as a minimum. Its current acceptance criteria requires the Order to be DELIVERED per CD-072.

**Options:**
- **PAID** — Payment captured, order confirmed (minimum threshold per FR-RW-001)
- **DELIVERED** — Product physically delivered (higher confidence)
- **CONFIRMED** — Vendor confirmed Order_Vendor_Group (between PAID and DELIVERED)

**Analysis:**
- PAID: Earliest, highest volume, but pre-fulfillment // **Reference:** FR-RW-001 explicitly uses PAID as minimum
- DELIVERED: Highest confidence, but delays reviews
- CONFIRMED: Good balance — vendor acknowledged order

**Recommendation:** **DELIVERED** (confirmed per CD-072, MP-08) — This analysis was superseded by CD-072 which confirms DELIVERED as the qualifying state for verified purchases.

**Decision:** Resolved as DELIVERED by CD-072.

---

### 6. Review Images

> Historical options below were resolved by CD-071: owned images are permitted. Current implementation stores validated review-owned files locally and limits each review to five images. Local storage is temporary; the S3 adapter is not yet connected.

**Current (conceptual_model.md Sec 14):** Review has `Product_Pic_List` (plural), relationship to Product_Pic ambiguous.

**Options:**
- **Owned images:** Review has its own images (uploaded with review)
- **Shared images:** Review references existing Product_Pic entities
- **Both:** Review can have own images + reference product images

**Recommendation:** **Owned images** — Review images are distinct (user-generated content), stored separately from vendor product images. Simpler ownership/permissions.

**Decision:** Owned images permitted (CD-071). The API currently uploads them to temporary local storage.

---

## Summary of Recommendations

| Decision Point | Recommendation | Requires Business Approval |
|----------------|----------------|----------------------------|
| Moderation Policy | Post-moderation (publish immediately, admin can hide/reject) | Resolved: CD-067 |
| Vendor Response | Not permitted | Resolved: CD-068 |
| Verified Purchase Badge | Not displayed | Resolved: CD-069 |
| Rating Scale | 1-5 stars | Resolved: CD-070 |
| Rating Aggregation | Simple arithmetic mean | Resolved: CD-070 |
| Verified Purchase State | DELIVERED | Resolved: CD-072 |
| Review Images | Owned images; temporary local storage currently, S3 adapter not connected | Resolved: CD-071 |

---

## Technical Details (implementation status)

Per project rules, these remain for implementation:
- Review.status values: `published`, `hidden`, `rejected`, `pending_report`
- Admin moderation UI (report queue, hide/reject actions)
- Rating recalculation triggers (on review create/update/delete/hide)
- Review images use temporary local storage with owner checks and image validation; the S3 adapter remains a separate future integration
- Review sorting (newest, highest rated, most helpful)
- Pagination for product review lists

---

## Traceability

- **CD-017** — Review Only by Verified Purchaser (Confirmed MP-02)
- **CD-023** — Order_Item keeps historical unit price
- **CD-041** — Vendor auto-publish (philosophy alignment)
- **CD-055** — Manual refresh MVP (no real-time)
- **Q-017** — Review Moderation & Display (RESOLVED by CD-067..CD-072)
- **FR-RW-001** — Review Creation by Verified Purchaser
- **FR-PEND-003** — Review moderation/display (Pendente)
- **T-117** — Resolve Q-017 Review moderation/display
- **T-1101** — Backend: Review API
- **T-1105** — Frontend: Review UI

---

## Next Steps

Present the 7 recommendations above to responsible for business approval. Each is a discrete decision that can be approved independently. Once approved, update:
1. decisions.md — Add new CDs for each approved rule
2. open_questions.md — Update Q-017 state
3. conceptual_model.md — Update Review concept with confirmed rules
4. functional_requirements.md — Add FR-RW-002..00N for new rules
5. task_list.md — T-117 → covered_by_decision