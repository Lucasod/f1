# Correction Note — MP-F04-012 Prior Status Inconsistency

**Run:** mp-f04-013-run-1
**Task:** MP-F04-013
**Purpose:** Document a prior status inconsistency in MP-F04-012 and the corrections that resolved it. Treated as a process-control deficiency; no prior agent is labeled dishonest and no intent is speculated.

## 1. What was reported in MP-F04-012

MP-F04-012 declared Integration Acceptance as PASS despite unresolved defects, specifically:

- 1 failing Django test (workspaces assignee filter).
- 1 failing Playwright test (workspace isolation).
- 4 skipped Playwright tests (conditional skips masking workspace-isolation behavior).
- Persistent workspace data leaking between tests (no per-test fixture isolation).

Because failing and skipped integration tests were present, integration acceptance could not honestly be PASS. The prior classification was premature.

## 2. What verified evidence actually demonstrated

Verified evidence from MP-F04-012 showed unresolved defects:

- The Django assignee-filter test used the wrong query parameter name (`assignee_username`) while the view expects `assignee`, so the filter behavior was not actually exercised.
- Four Playwright tests were conditionally skipped (`test.skip()`), meaning workspace-isolation behavior was not verified in those cases.
- Tests shared workspace state, so a failure in one test could persist and affect subsequent tests (persistent workspace data).
- Five Playwright files errored at import because `test-credentials.ts` had no fallback for `SECRET_TEST_PASS` / `INVALID_TEST_PASS`.

Integration acceptance requires all suites to pass with zero skips and stable repetition. MP-F04-012 did not meet that bar; therefore its Integration Acceptance = PASS was insufficient and could not stand.

## 3. Why the previous acceptance classification was insufficient

- A Reviewer PASS verdict does not override failing integration tests. Review verdicts assess the change under review; they do not rewrite test outcomes.
- Pre-existing failures remain failures until the underlying defect is fixed and the test passes on a clean run.
- Acceptance classification must be grounded in observed test results (Django and Playwright exit codes, skip counts, consecutive-cycle stability), not in declarations that contradict the evidence.

## 4. Corrections that resolved the outstanding failures

### 4.1 Django assignee filter (`backend/workspaces/tests/test_projects.py`)

- Root cause: the test filtered issues using query parameter `assignee_username`, but the view reads `assignee`.
- Fix: corrected the parameter name to `assignee` to match the view contract, and added `bob` as a workspace member before issue creation so the cross-member filter scenario is valid.
- Regression coverage added: `test_list_issues_filter_by_assignee_different_member` and `test_list_issues_filter_by_assignee_no_assignee`.

### 4.2 Playwright workspace isolation (`tests/e2e-02-workspace-isolation-playwright.ts`)

- Removed all 4 `test.skip()` calls so workspace-isolation behavior is exercised, not conditionally suppressed.
- Made Tests 3, 6, and 7 self-contained with unique `Date.now()` workspace names, eliminating dependence on shared state from earlier tests.
- Test 4 now looks up Workspace B via the Django ORM (`execSync`) instead of a shared in-memory variable.
- Per-test fixture isolation: each test creates and uses its own workspace, so no workspace data persists across tests.

### 4.3 Playwright test isolation infrastructure (`playwright.config.ts`)

- Changed workers from `process.env.CI ? 1 : undefined` to `workers: 1` to satisfy the shared SQLite DB single-writer constraint and guarantee serial test execution.

### 4.4 Playwright credentials fallback (`tests/test-credentials.ts`)

- Added fallback values for `SECRET_TEST_PASS` and `INVALID_TEST_PASS` so the 5 Playwright files that import credentials no longer error at import when the env vars are unset.
- These fallback values are synthetic test fixtures only (e.g. `testpass123`, `wrongpass`); no real credentials are used or disclosed.

## 5. New verified acceptance status

| Suite | Result |
|-------|--------|
| Django | 67/67 PASS, exit code 0, 3 consecutive stable cycles |
| Playwright | 53/53 PASS, 0 skipped, exit code 0, 3 consecutive stable cycles |
| TypeScript/JavaScript | No build step configured (N/A) |
| Secret scanner | Clean (exit 0), zero credential disclosure |

- Reviewer verdict: PASS
- Test verdict: PASS
- Integration acceptance: PASS
- Mission status: COMPLETE

With DJANGO 67/67, PLAYWRIGHT 53/53, 0 skips, 3 consecutive stable cycles, Reviewer PASS, and Test PASS, INTEGRATION_ACCEPTANCE = PASS is now supported by verified evidence.
