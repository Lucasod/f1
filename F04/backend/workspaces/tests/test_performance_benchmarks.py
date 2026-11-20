"""Performance benchmarks for the F04 backend API.

These tests measure p50 and p95 response times for core API endpoints
using the Django test client and synthetic credentials. They document
baseline latency only: no official PASS/FAIL performance thresholds
exist in the project requirements, so no latency threshold is asserted.

Each benchmark runs an endpoint N times, records the wall-clock time of
every response, and reports the observed p50/p95. Correctness (HTTP
status) is asserted; performance is reported as an observed baseline.
"""

import math
import os
import time

from django.test import TestCase
from rest_framework.test import APIClient
from django.contrib.auth import get_user_model

from workspaces.models import (
    Board,
    Issue,
    Membership,
    Notification,
    Project,
    WorkflowStatus,
    Workspace,
)

User = get_user_model()

# Synthetic test credentials only. Never a real user password or secret.
BENCH_USERNAME = "bench_user"
BENCH_EMAIL = "bench@example.com"
# Synthetic test credential only, read from env with a synthetic fallback
# (matches the convention used by the other tests in this suite).
BENCH_PASSWORD = os.getenv("BENCH_TEST_PASSWORD", "bench-pass-synthetic-12345")

REPEATS = 50


def _percentile(sorted_times, p):
    """Nearest-rank percentile (p in 0..100) over a sorted list of seconds."""
    n = len(sorted_times)
    if n == 0:
        return 0.0
    rank = max(1, min(n, int(math.ceil(p / 100.0 * n))))
    return sorted_times[rank - 1]


class PerformanceBenchmarkTestCase(TestCase):
    """Baseline response-time benchmarks for core API endpoints."""

    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            BENCH_USERNAME, BENCH_EMAIL, BENCH_PASSWORD
        )
        self.client.login(username=BENCH_USERNAME, password=BENCH_PASSWORD)

        self.workspace = Workspace.objects.create(name="Bench Workspace")
        Membership.objects.create(
            user=self.user, workspace=self.workspace, role="owner"
        )

        self.project = Project.objects.create(
            key="BENCH", name="Bench Project", workspace=self.workspace,
        )
        self.board = Board.objects.create(
            project=self.project, name="Bench Board", workspace=self.workspace,
        )
        self.status_todo = WorkflowStatus.objects.create(
            board=self.board, name="to_do", position=1,
        )
        WorkflowStatus.objects.create(
            board=self.board, name="in_progress", position=2,
        )
        WorkflowStatus.objects.create(
            board=self.board, name="done", position=3,
        )
        for i in range(1, 6):
            Issue.objects.create(
                board=self.board,
                number=i,
                title=f"Bench Issue {i}",
                status_id=self.status_todo,
            )
        # Advance the project's monotonic issue counter so the
        # create-issue endpoint (which allocates from next_issue_number)
        # does not collide with the pre-created issues above.
        self.project.next_issue_number = 6
        self.project.save(update_fields=["next_issue_number"])

        Notification.objects.create(
            user=self.user,
            workspace=self.workspace,
            notification_type="issue_assigned",
            entity_type="issue",
            entity_id=1,
            payload={},
            is_read=False,
        )

    def _bench(self, label, callable_, expected_statuses):
        """Run ``callable_`` REPEATS times; assert statuses; report p50/p95."""
        times = []
        statuses = []
        for _ in range(REPEATS):
            start = time.perf_counter()
            response = callable_()
            elapsed = time.perf_counter() - start
            times.append(elapsed)
            statuses.append(response.status_code)

        bad = [s for s in statuses if s not in expected_statuses]
        self.assertFalse(
            bad,
            f"{label}: unexpected statuses {sorted(set(bad))}; "
            f"expected {sorted(expected_statuses)}",
        )

        times.sort()
        p50 = _percentile(times, 50)
        p95 = _percentile(times, 95)
        print(
            "\n[BENCH] %(label)s: n=%(n)d p50=%(p50).2fms p95=%(p95).2fms "
            "min=%(min).2fms max=%(max).2fms  "
            "(baseline only; no official threshold)" % {
                "label": label,
                "n": REPEATS,
                "p50": p50 * 1000,
                "p95": p95 * 1000,
                "min": times[0] * 1000,
                "max": times[-1] * 1000,
            }
        )
        return p50, p95

    # 1. Authentication login response time
    def test_auth_login_response_time(self):
        """POST /api/v1/auth/login/ response time (baseline)."""

        def call():
            return self.client.post(
                "/api/v1/auth/login/",
                {"username": BENCH_USERNAME, "password": BENCH_PASSWORD},
                format="json",
            )

        self._bench("auth/login", call, {200})

    # 2. Workspace listing response time
    def test_workspace_listing_response_time(self):
        """GET /api/v1/workspaces/ response time (baseline)."""

        def call():
            return self.client.get("/api/v1/workspaces/", format="json")

        self._bench("workspaces/list", call, {200})

    # 3. Project listing response time
    def test_project_listing_response_time(self):
        """GET /api/v1/projects/ response time (baseline)."""

        def call():
            return self.client.get("/api/v1/projects/", format="json")

        self._bench("projects/list", call, {200})

    # 4. Issue listing response time
    def test_issue_listing_response_time(self):
        """GET /api/v1/issues/?project_id= response time (baseline)."""

        def call():
            return self.client.get(
                f"/api/v1/issues/?project_id={self.project.id}", format="json"
            )

        self._bench("issues/list", call, {200})

    # 5. Issue creation response time
    def test_issue_creation_response_time(self):
        """POST /api/v1/projects/{id}/issues/ response time (baseline)."""

        counter = {"i": 0}

        def call():
            counter["i"] += 1
            return self.client.post(
                f"/api/v1/projects/{self.project.id}/issues/",
                {"title": f"Bench Created Issue {counter['i']}"},
                format="json",
            )

        self._bench("issues/create", call, {201})

    # 6. Kanban board loading response time
    def test_kanban_board_loading_response_time(self):
        """GET /api/v1/boards/{id}/workflow/ response time (baseline)."""

        def call():
            return self.client.get(
                f"/api/v1/boards/{self.board.id}/workflow/", format="json"
            )

        self._bench("boards/workflow (kanban)", call, {200})

    # 7. Notifications listing response time
    def test_notifications_listing_response_time(self):
        """GET /api/v1/notifications/?workspace_id= response time (baseline)."""

        def call():
            return self.client.get(
                f"/api/v1/notifications/?workspace_id={self.workspace.id}",
                format="json",
            )

        self._bench("notifications/list", call, {200})

    # 8. Report generation response time
    def test_report_generation_response_time(self):
        """POST /api/v1/reports/ response time (baseline)."""

        def call():
            return self.client.post(
                "/api/v1/reports/",
                {
                    "report_type": "issues_by_status",
                    "workspace_id": self.workspace.id,
                },
                format="json",
            )

        self._bench("reports/create", call, {201})
