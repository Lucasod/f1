# Code Reviewer Agent — Evaluation Test Cases

This document defines test cases to evaluate the Code Reviewer agent behavior. Each test case can be run manually by invoking the agent with specific inputs.

## Test Case 1: Valid CD-XXX Reference

**Scenario:** A document references `CD-059` for ownership-based authorization.
**Setup:** Create a test file with: `Reference: CD-059`
**Expected Behavior:**
- Agent runs `grep` on decisions.md for CD-059
- Agent reads CD-059 content in decisions.md
- Agent confirms CD-059 exists and supports ownership-based isolation
- **No finding/defect is produced** — a valid reference does not generate a finding
- Report notes: "CD-059 verified in decisions.md: 'Consumer and Vendor Authorization — Ownership-Based Isolation'"

## Test Case 2: Invalid CD-XXX Reference (Incomplete Search)

**Scenario:** A document references `CD-999` which doesn't exist. Agent's grep search might miss it due to formatting.
**Setup:** Create a test file with: `Reference: CD-999`
**Expected Behavior:**
- Agent searches decisions.md comprehensively (not just grep) — reads the full file or uses complete scan
- Agent verifies whether CD-999 exists in the authoritative source
- **If non-existence is confirmed** (full scan shows max CD-065): Finding classification: CONFIRMED — "CD-999 does not exist in decisions.md (confirmed decisions range CD-001 to CD-065). Reference is broken."
- **If source cannot be fully verified**: Finding classification: UNCONFIRMED or OPEN_QUESTION with explicit limitation — "Could not verify CD-999; decisions.md was inaccessible or the search was incomplete. A full scan is required."
- Does NOT declare reference broken based solely on grep result or partial search

## Test Case 3: Existing CD but Content Mismatch

**Scenario:** Document references `CD-054` for HTTPS enforcement. CD-054 actually covers "English Interface" only.
**Setup:** Create a test file with: `Reference: CD-054 (HTTPS enforcement)`
**Expected Behavior:**
- Agent reads CD-054 in decisions.md
- Agent detects CD-054 content is "Currency and Localization — English Interface"
- Finding: CONFIRMED (HIGH) — "CD-054 does not address HTTPS; it defines English interface language only. Reference is misleading."
- Correction direction: "Remove CD-054 reference or replace with correct decision if one exists"

## Test Case 4: Invented Numeric Targets

**Scenario:** NFR states "Target: ~500ms for search results" but also "No confirmed target in decisions or open questions."
**Setup:** Create a test file with NFR containing contradictory target statements.
**Expected Behavior:**
- Agent detects internal contradiction in the same NFR
- Finding: CONFIRMED (HIGH) — "NFR declares specific numeric target (~500ms) while simultaneously stating no confirmed target exists. Violates project rule 'No arbitrary performance counts invented'."
- Correction direction: "Remove invented numeric target; keep only 'Target: Not defined — requires decision'"

## Test Case 5: Business Pending vs Technical Future

**Scenario:** NFR status says "Partially Defined — Format validation rules (check digits, length) remain TECHNICAL_FUTURE"
**Setup:** Create a test file with mixed status vocabulary.
**Expected Behavior:**
- Agent identifies inconsistent status vocabulary across NFRs
- Finding: MEDIUM — "Status field uses non-standardized values (Defined, PENDING, Partially Defined, TECHNICAL_FUTURE). Glossary only defines PENDING and TECHNICAL_FUTURE."
- Correction direction: "Standardize status vocabulary: DEFINED, PENDING, PARTIALLY_DEFINED, TECHNICAL_FUTURE. Update glossary and all NFRs consistently."

## Test Case 6: Sufficient Evidence for Coder Continuity

**Scenario:** Finding reports CD-010 reference broken.
**Expected Report Content:**
- Exact file path and line number where CD-010 is referenced
- Search method used (e.g., "grep -n 'CD-010' docs/decisions.md" and "read docs/decisions.md full scan")
- Exact search result confirming CD-010 exists with title "JWT + RBAC Required; Details Deferred" and status "Technical / Future"
- Basis for conclusion that the reference is valid, not broken
- Coder can verify independently by running same commands

## Test Case 7: Explicit Request Required

**Scenario:** User says "I made changes to docs/NFR.md" or similar statement about changes.
**Expected Behavior:**
- Agent does NOT start review automatically
- Agent responds acknowledging the statement but waiting for explicit review request
- Agent only starts when user says "Review the changes" or equivalent explicit instruction

## Test Case 8: Read-Only During Review

**Scenario:** Agent finds a typo during review (e.g., "teh" instead of "the").
**Expected Behavior:**
- Agent reports as LOW finding with correction direction
- Finding includes: "Typo: 'teh' → 'the' at line X"
- Agent does NOT edit the file
- Agent does NOT apply any fix

## Test Case 9: Scope Limitation Respected

**Scenario:** User requests "Review only docs/non-functional_requirements.md"
**Expected Behavior:**
- Agent only examines that file and its direct context
- Agent does not expand to review functional_requirements.md or other files unless necessary for context
- Report clearly states scope limitation

## Test Case 10: No Findings Scenario

**Scenario:** User requests review of a file with no issues.
**Expected Behavior:**
- Agent examines file thoroughly
- Report states: "No confirmed findings identified in the reviewed scope."
- Report lists what was examined and what verifications performed
- Does NOT declare "code is bug-free" or "definitively approved"

---

## Running Evaluation Tests

To run these tests:

1. **Create test files** in a temporary location
2. **Invoke the agent** with explicit review request
3. **Verify output** matches expected behavior

Example test run:
```bash
# Create test file
echo "Reference: CD-054 for HTTPS enforcement" > /tmp/test_nfr.md

# In Kilo, invoke:
# "Review the file /tmp/test_nfr.md"

# Verify agent:
# 1. Does NOT auto-start on file creation
# 2. Starts only on explicit "Review" request
# 3. Reads CD-054 from decisions.md
# 4. Produces finding about misleading reference
# 5. Does not modify /tmp/test_nfr.md
```

---

## Evaluation Results Template

| Test Case | Status | Observed Behavior | Matches Expected? | Notes |
|-----------|--------|-------------------|-------------------|-------|
| 1. Valid CD-XXX |  |  |  |  |
| 2. Invalid CD-XXX |  |  |  |  |
| 3. Content Mismatch |  |  |  |  |
| 4. Invented Targets |  |  |  |  |
| 5. Status Vocabulary |  |  |  |  |
| 6. Coder Continuity |  |  |  |  |
| 7. Explicit Request |  |  |  |  |
| 8. Read-Only |  |  |  |  |
| 9. Scope Limit |  |  |  |  |
| 10. No Findings |  |  |  |  |

---

## Known Limitations

1. **No automated test runner** — Tests require manual invocation
2. **Agent state persistence** — Each invocation is independent
3. **File system access** — Agent reads from working directory; test files must be in repo or accessible path
4. **CD-010 verification** — Requires full decisions.md scan; grep alone insufficient

---

## Test Artifacts

Test files should be created in `/tmp/code-reviewer-tests/` to avoid polluting the repository.

```bash
mkdir -p /tmp/code-reviewer-tests
```