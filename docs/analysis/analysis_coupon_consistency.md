# Coupon Consistency Analysis — T-116 / Q-016

## Objective
Verify consistency between decisions.md, open_questions.md, conceptual_model.md, functional_requirements.md, and task_list.md regarding coupon rules.

## Confirmed Rules (CD-050 / MP-07E) — All Documents Agree

| Rule | Description | decisions.md | open_questions.md | conceptual_model.md | functional_requirements.md | task_list.md | Location References |
|------|-------------|--------------|-------------------|---------------------|----------------------------|--------------|---------------------|
| 1 | Inclusion lists target products & categories | ✅ CD-050 | ✅ Q-016 | ✅ Sec 15, 16 | ✅ FR-COUPON-004 | ✅ T-116 | decisions.md:399, open_questions.md:211, conceptual_model.md:263, functional_requirements.md:1290, task_list.md:53 |
| 2 | Including category includes descendants | ✅ CD-050 | ✅ Q-016 | ✅ Sec 15, 16 | ✅ FR-COUPON-004 | ✅ T-116 | Same as Rule 1 |
| 3 | Exclusion lists target products & categories | ✅ CD-050 | ✅ Q-016 | ✅ Sec 15, 16 | ✅ FR-COUPON-004 | ✅ T-116 | Same as Rule 1 |
| 4 | Excluding category excludes descendants | ✅ CD-050 | ✅ Q-016 | ✅ Sec 15, 16 | ✅ FR-COUPON-004 | ✅ T-116 | Same as Rule 1 |
| 5 | Exclusions override inclusions | ✅ CD-050 | ✅ Q-016 | ✅ Sec 15, 16 | ✅ FR-COUPON-004 | ✅ T-116 | Same as Rule 1 |
| 6 | No stacking (max 1 coupon/vendor/purchase) | ✅ CD-050 | ✅ Q-016 | ✅ Sec 15, 16 | ✅ FR-COUPON-003 | ✅ T-116 | decisions.md:399, open_questions.md:211, conceptual_model.md:263, functional_requirements.md:1261, task_list.md:53 |
| 7 | No automatic priority between coupons | ✅ CD-050 | ✅ Q-016 | ✅ Sec 15, 16 | ✅ FR-COUPON-003 | ✅ T-116 | Same as Rule 6 |
| 8 | Consumer selects eligible coupon per vendor | ✅ CD-050 | ✅ Q-016 | ✅ Sec 15, 16 | ✅ FR-COUPON-003 | ✅ T-116 | Same as Rule 6 |
| 9 | Coupon applied at Order_Vendor_Group level | ✅ CD-026 | ✅ Q-016 | ✅ Sec 18 | ✅ FR-COUPON-005 | ✅ T-116 | decisions.md:215, open_questions.md:211, conceptual_model.md:328, functional_requirements.md:1323, task_list.md:53 |
| 10 | Mixed-cart discount calculation = PENDING | ✅ CD-050 | ✅ Q-016 | ✅ Sec 15, 16 | ✅ FR-COUPON-006 Note + FR-PEND-004 | ✅ T-116 | decisions.md:399, open_questions.md:211, conceptual_model.md:263, functional_requirements.md:1350, task_list.md:53 |

**Result: All 10 confirmed rules are consistent across all 5 documents.**

---

## Identified Inconsistency: Coupon vs Coupon_Target Attribute Ownership

### Location
`conceptual_model.md` — Section 15 (Coupon) and Section 16 (Coupon_Target)

### Issue
Both sections note the same open question:
> "Coupon vs Coupon_Target attribute ownership: only Coupon_Target (section 16) currently declares Product_List and Category_List; Coupon (section 15) no longer declares these attributes. The final attribute allocation between Coupon and Coupon_Target requires a business decision"

### Current State in conceptual_model.md
- **Coupon (Sec 15):** Attributes = Vendor, Code, Discount_Type, Discount_Value, Starts_At, Ends_At. **No** Product_List, Category_List.
- **Coupon_Target (Sec 16):** Attributes = Coupon (ref), Product_List, Category_List.

### Analysis
This is a **modeling notation inconsistency**, not a business rule conflict. The conceptual model shows:
- Coupon 1:1 Coupon_Target
- Coupon_Target holds the targeting lists (Product_List, Category_List)

This is a valid design: Coupon holds the "what" (code, discount, validity), Coupon_Target holds the "where" (products/categories). The note correctly identifies this as requiring a business decision on whether this split is intentional or if attributes should be consolidated.

### Impact
- **Business rules:** None — all 10 confirmed rules are unaffected
- **Implementation:** Affects physical schema design (T-301) and API design (T-402)
- **Functional requirements:** FR-COUPON-004 references "Coupon_Target" concept correctly

### Recommendation
This is a **TECHNICAL_FUTURE** decision (physical modeling). The conceptual model correctly represents the 1:1 relationship. The note should remain as a reminder for implementation phase. No conceptual decision needed.

---

## Other Open Questions in Q-016 (Documented, Not Inconsistencies)

| Question | Status | Location |
|----------|--------|----------|
| Discount_Type values (percentage, fixed, free_shipping)? | PENDING | Q-016, conceptual_model.md Sec 15 |
| Usage limits (per coupon, per user, total)? | PENDING | Q-016, conceptual_model.md Sec 15 |
| Minimum order value? | PENDING | Q-016, conceptual_model.md Sec 15 |
| Platform-wide coupons vs vendor-only? | PENDING | Q-016, conceptual_model.md Sec 15 |
| Product_List/Category_List as arrays of refs? | TECHNICAL_FUTURE | Q-016, conceptual_model.md Sec 16 |
| "All products" vs specific selection semantics? | TECHNICAL_FUTURE | Q-016, conceptual_model.md Sec 16 |
| Mixed-cart discount calculation | PENDING (business) | Q-016, FR-PEND-004, conceptual_model.md Sec 15, 16 |

All correctly tracked as open across documents. No inconsistencies.

---

## Task List Status

**T-116:** ✅ `covered_by_decision` — Correct. The 6 stacking/priority rules (MP-07E) and 4 inclusion/exclusion rules (CD-050) are confirmed. Only mixed-cart discount remains PENDING (FR-PEND-004), correctly noted as implementation detail for T-902.

---

## Summary

| Aspect | Status |
|--------|--------|
| Business rules (10 confirmed) | ✅ Consistent across all documents |
| Coupon/Coupon_Target attribute split | ⚠️ Noted inconsistency in conceptual_model.md (documented, not a conflict) |
| Open questions tracking | ✅ Consistent across documents |
| Task status | ✅ Correctly `covered_by_decision` |
| Mixed-cart discount | ✅ Correctly PENDING in all documents |

**No action required.** The documentation is consistent. The Coupon/Coupon_Target attribute ownership note is a valid implementation-phase reminder, not a conceptual inconsistency.

---

## Traceability
- **CD-050** — Coupon Inclusion/Exclusion Rules (Confirmed MP-02, MP-07E)
- **CD-026** — Coupon and Coupon_Target accepted as concepts
- **CD-027** — Product_List, Category_List are lists, not entities
- **Q-016** — Coupon Inclusion/Exclusion & Stacking Rules (PARTIALLY_RESOLVED)
- **FR-COUPON-001..006** — Functional requirements
- **FR-PEND-004** — Mixed-cart discount calculation (Pendente)
- **T-116** — Coupon targeting and stacking rules (covered_by_decision)
- **T-902** — Checkout API (mixed-cart discount implementation)