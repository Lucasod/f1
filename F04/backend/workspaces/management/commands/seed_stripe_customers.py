"""Seed deterministic development data for the full F04 platform.

Local-only mode (no --sync-stripe): creates all deterministic data
without calling Stripe. WorkspaceBilling rows use effective_plan="free"
and customer_id is left null.

--sync-stripe: creates/retrieves Stripe Customers via StripeAdapter for
workspaces missing customer_id. Requires STRIPE_API_KEY (and
STRIPE_WEBHOOK_SECRET) to be set in the environment.

--create-workspaces: creates deterministic development workspaces
(Dev Workspace, Prod Workspace) with a free WorkspaceBilling row and an
owner membership, then proceeds with the normal Stripe sync for any
workspace missing customer_id.

--full-seed: creates the complete deterministic dataset including:
  - Synthetic users (alice, bob, with distinct roles: owner/admin/member)
  - Free and Pro workspaces with proper billing
  - Memberships and isolation scenarios
  - Projects with boards and workflow statuses
  - Issues distributed between columns
  - Sprints and assignments
  - Comments
  - Audit events consistent with operations
  - Internal notifications
  - Data for async reports
  - Controlled webhook configuration
  - WorkspaceBilling and Stripe Test Mode links (customer_id only,
    never creates paid subscriptions automatically)
  - Idempotent: re-running preserves existing data and allows
    environment reconstruction without duplications

Idempotent: workspaces, users, billing plans, and customers that
already exist are skipped. Running twice produces the same dataset.
Only Customer objects are created — never subscriptions.
"""

import os

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from workspaces.models import (
    Workspace,
    WorkspaceBilling,
    Membership,
    Project,
    Board,
    WorkflowStatus,
    WorkflowTransition,
    Sprint,
    Issue,
    Comment,
    AuditLog,
    Notification,
    Report,
    WebhookSubscription,
    WebhookDelivery,
    BillingPlan,
)


# ── Deterministic development workspaces ──────────────────────────────
DETERMINISTIC_WORKSPACES = [
    {"name": "Dev Workspace", "metadata_key": "dev_workspace_1"},
    {"name": "Prod Workspace", "metadata_key": "dev_workspace_2"},
]

# ── Synthetic users with distinct roles ───────────────────────────────
SEED_USERS = [
    {"username": "alice", "email": "alice@example.com", "roles": ["owner"]},
    {"username": "bob", "email": "bob@example.com", "roles": ["member"]},
    {"username": "carol", "email": "carol@example.com", "roles": ["admin"]},
]

# ── Billing plan data (Free/Pro) ──────────────────────────────────────
BILLING_PLAN_DATA = [
    {
        "plan_id": "free",
        "name": "Free",
        "description": "Free plan for small teams",
        "max_memberships": 5,
        "max_projects": 2,
        "price_cents": 0,
        "currency": "usd",
        "interval": "month",
    },
    {
        "plan_id": "pro",
        "name": "Pro",
        "description": "Pro plan for growing teams",
        "max_memberships": 25,
        "max_projects": 20,
        "price_cents": 1900,
        "currency": "usd",
        "interval": "month",
    },
]

# ── Controlled webhook configuration ──────────────────────────────────
WEBHOOK_SUBSCRIPTIONS = [
    {
        "url": "https://example.com/webhook/issue-created",
        "events": ["issue.created", "issue.status_changed"],
    },
    {
        "url": "https://example.com/webhook/issue-updated",
        "events": ["issue.status_changed"],
    },
]


class Command(BaseCommand):
    help = "Seed deterministic development data for the full F04 platform"

    def add_arguments(self, parser):
        parser.add_argument(
            "--sync-stripe",
            action="store_true",
            help="Actually create Stripe Customers via Stripe API (requires STRIPE_API_KEY)",
        )
        parser.add_argument(
            "--workspace-id",
            type=int,
            help="Limit to a specific workspace ID",
        )
        parser.add_argument(
            "--create-workspaces",
            action="store_true",
            help="Create deterministic development workspaces (Dev Workspace, "
            "Prod Workspace) with free billing and an owner membership, then "
            "proceed with the normal Stripe sync for any workspace missing "
            "a customer_id.",
        )
        parser.add_argument(
            "--full-seed",
            action="store_true",
            help="Create the complete deterministic dataset including users, "
            "workspaces, projects, boards, workflows, issues, sprints, comments, "
            "audit events, notifications, reports, and webhook configuration. "
            "Stripe customers are created (never paid subscriptions).",
        )
        parser.add_argument(
            "--seed-users",
            action="store_true",
            help="Create synthetic users (alice, bob, carol) with distinct roles.",
        )
        parser.add_argument(
            "--seed-plans",
            action="store_true",
            help="Seed Free and Pro BillingPlan records.",
        )

    def handle(self, *args, **options):
        create_workspaces = options["create_workspaces"]
        sync_stripe = options["sync_stripe"]
        full_seed = options["full_seed"]
        seed_users = options["seed_users"]
        seed_plans = options["seed_plans"]
        workspace_id = options.get("workspace_id")

        # Check Stripe configuration. All Stripe config comes from env vars;
        # nothing is hardcoded.
        stripe_configured = bool(
            settings.STRIPE_API_KEY and settings.STRIPE_WEBHOOK_SECRET
        )

        if sync_stripe and not stripe_configured:
            raise CommandError(
                "--sync-stripe requires STRIPE_API_KEY and STRIPE_WEBHOOK_SECRET "
                "environment variables to be set."
            )

        # ── Step 0: Seed BillingPlan records if requested ────────────────
        if seed_plans:
            self._seed_billing_plans()

        # ── Step 1: Create synthetic users if requested ──────────────────
        users = {}
        if seed_users:
            users = self._seed_users()

        # ── Step 2: Create deterministic development workspaces if requested
        # ── (runs before Stripe sync so freshly created workspaces are included)
        if create_workspaces or full_seed:
            self._create_deterministic_workspaces(users)

        # ── Step 3: Full seed - create complete dataset ──────────────────
        if full_seed:
            self._full_seed(users)

        # ── Step 4: Workspaces with a billing row but no Stripe customer_id
        billing_qs = WorkspaceBilling.objects.select_related("workspace")
        if workspace_id:
            billing_qs = billing_qs.filter(workspace_id=workspace_id)

        billing_without_customer = billing_qs.filter(
            customer_id__isnull=True
        ) | billing_qs.filter(customer_id="")

        if not billing_without_customer.exists():
            self.stdout.write(
                self.style.SUCCESS(
                    "All workspaces with billing have Stripe Customer IDs."
                )
            )
            return

        self.stdout.write(
            f"Found {billing_without_customer.count()} workspace(s) without Stripe Customer ID."
        )

        if not sync_stripe:
            self.stdout.write(
                "Run with --sync-stripe to create Stripe Customers."
            )
            for wb in billing_without_customer:
                self.stdout.write(
                    f"  - Workspace {wb.workspace_id} ({wb.workspace.name})"
                )
            return

        # Sync with Stripe. Reuses StripeAdapter.create_customer; no direct
        # Stripe SDK calls in this command.
        adapter = StripeAdapter()
        created = 0
        failed = 0
        skipped = 0

        for wb in billing_without_customer:
            try:
                customer_id = adapter.create_customer(
                    idempotency_key=f"workspace-{wb.workspace.id}-seed-customer",
                    metadata={
                        "workspace_email": f"workspace-{wb.workspace.id}@example.com",
                        "workspace_id": str(wb.workspace.id),
                        "workspace_name": wb.workspace.name,
                    },
                )
                wb.customer_id = customer_id
                wb.save(update_fields=["customer_id", "updated_at"])
                created += 1
                self.stdout.write(
                    self.style.SUCCESS(
                        f"  - Created Stripe Customer {customer_id} for workspace {wb.workspace_id}"
                    )
                )
            except Exception as exc:
                failed += 1
                self.stdout.write(
                    self.style.ERROR(
                        f"  - Failed to create Stripe Customer for workspace {wb.workspace_id}: {exc}"
                    )
                )

        self.stdout.write(
            self.style.SUCCESS(
                f"\nDone: {created} created, {failed} failed, {skipped} skipped."
            )
        )

    # ── Helper: seed BillingPlan records ───────────────────────────────
    def _seed_billing_plans(self):
        """Seed Free and Pro BillingPlan records idempotently."""
        from workspaces.models import BillingPlan

        created_total = 0
        for plan_data in BILLING_PLAN_DATA:
            plan, created = BillingPlan.objects.get_or_create(
                plan_id=plan_data["plan_id"],
                defaults=plan_data,
            )
            if created:
                created_total += 1
                self.stdout.write(
                    self.style.SUCCESS(
                        f"  - Seeded BillingPlan: {plan_data['plan_id']} ({plan.name})"
                    )
                )
            else:
                self.stdout.write(
                    f"  - Skipped existing BillingPlan: {plan_data['plan_id']}"
                )
        self.stdout.write(
            f"\nBilling plans: {created_total} created, rest preserved.\n"
        )

    # ── Helper: seed synthetic users ───────────────────────────────────
    def _seed_users(self):
        """Create synthetic users with distinct roles idempotently.

        Returns a dict mapping username -> User object.
        """
        User = get_user_model()
        created = 0
        users = {}

        for user_info in SEED_USERS:
            username = user_info["username"]
            email = user_info["email"]
            roles = user_info["roles"]

            user, created_flag = User.objects.get_or_create(
                username=username,
                defaults={"email": email, "is_staff": True, "is_superuser": True},
            )
            if created_flag:
                created += 1
                # Use SEED_OWNER_PASSWORD env var or synthetic test password
                password = os.environ.get("SEED_OWNER_PASSWORD", "testpass123")
                user.set_password(password)
                user.save()
                self.stdout.write(
                    self.style.SUCCESS(f"  - Created user: {username}")
                )
            else:
                self.stdout.write(
                    f"  - Skipped existing user: {username}"
                )
            users[username] = user

        self.stdout.write(f"\nSeed users: {created} created, rest preserved.\n")
        return users

    # ── Helper: create deterministic dev workspaces ────────────────────
    def _create_deterministic_workspaces(self, users):
        """Create deterministic dev workspaces idempotently.

        Each workspace gets a free WorkspaceBilling row and an owner
        membership for the appropriate seed user. Workspaces that already
        exist (exact name match) are skipped. select_for_update() within a
        transaction guards against concurrent runs both deciding to create.
        """
        owner = users.get("alice") or self._get_owner_user()

        created = 0
        skipped = 0

        for ws_info in DETERMINISTIC_WORKSPACES:
            name = ws_info["name"]
            metadata_key = ws_info["metadata_key"]

            with transaction.atomic():
                # Lock any existing row with this name so concurrent runs
                # cannot both decide to create. If none exists, create it.
                existing = (
                    Workspace.objects.select_for_update()
                    .filter(name=name)
                    .first()
                )
                if existing is not None:
                    self.stdout.write(
                        f"  - Skipped existing workspace: {name}"
                    )
                    skipped += 1
                    workspace = existing
                else:
                    workspace = Workspace.objects.create(name=name)
                    WorkspaceBilling.objects.create(
                        workspace=workspace, effective_plan="free"
                    )
                    owner, membership_created = Membership.objects.get_or_create(
                        user=owner, workspace=workspace, role="owner"
                    )
                    if membership_created:
                        created += 1
                    self.stdout.write(
                        self.style.SUCCESS(
                            f"  - Created workspace '{name}' "
                            f"(id={workspace.id}, metadata_key={metadata_key})"
                        )
                    )

        self.stdout.write(
            f"\nDeterministic workspaces: {created} created, {skipped} skipped.\n"
        )
        return workspace

    # ── Helper: get owner user ─────────────────────────────────────────
    def _get_owner_user(self):
        """Return an existing owner user, or create a deterministic one."""
        User = get_user_model()
        user = User.objects.filter(is_superuser=True).first()
        if user is None:
            user = User.objects.first()
        if user is None:
            user = User.objects.create_user(
                "seed_owner",
                "seed_owner@example.com",
                os.environ.get("SEED_OWNER_PASSWORD", "testpass123"),
            )
        return user

    # ── Helper: get dummy user ─────────────────────────────────────────
    def _get_dummy_user(self):
        """Return a dummy user for cases where no seed users are available."""
        User = get_user_model()
        user, _ = User.objects.get_or_create(
            username="seed_dummy",
            defaults={"email": "seed-dummy@example.com", "is_staff": True},
        )
        return user

    # ── Helper: full seed - create complete deterministic dataset ───────
    def _full_seed(self, users):
        """Create the complete deterministic dataset.

        Includes: workspaces, projects, boards, workflow statuses,
        issues, sprints, comments, audit events, notifications, reports,
        and webhook configuration. Idempotent - preserves existing data.
        """
        from workspaces.models import (
            Project,
            Board,
            WorkflowStatus,
            WorkflowTransition,
            Sprint,
            Issue,
            Comment,
            AuditLog,
            Notification,
            Report,
            WebhookSubscription,
            WebhookDelivery,
        )

        ensured_ws = set()

        for ws_info in DETERMINISTIC_WORKSPACES:
            name = ws_info["name"]

            with transaction.atomic():
                existing = Workspace.objects.select_for_update().filter(name=name).first()
                if existing is not None:
                    workspace = existing
                    ensured_ws.add(workspace.id)
                else:
                    workspace = Workspace.objects.create(name=name)
                    # Ensure billing record
                    billing, billing_created = WorkspaceBilling.objects.get_or_create(
                        workspace=workspace, defaults={"effective_plan": "free"}
                    )
                    if billing_created:
                        self.stdout.write(
                            f"  - Created billing for workspace {workspace.id}"
                        )
                    # Use alice as owner
                    owner = users.get("alice") or self._get_owner_user()
                    Membership.objects.get_or_create(
                        user=owner, workspace=workspace, role="owner"
                    )
                    ensured_ws.add(workspace.id)
                    self.stdout.write(
                        f"  - Created workspace '{name}' (id={workspace.id})\n"
                    )

                # Build the complete dataset for this workspace
                self._build_workspace_dataset(
                    workspace, users, list(ensured_ws)
                )

        self.stdout.write(
            f"\nFull seed workspaces ensured: {len(ensured_ws)} unique workspaces.\n"
        )

    # ── Helper: build complete dataset for one workspace ────────────────
    def _build_workspace_dataset(self, workspace, users, ensured_ws_ids):
        """Build the complete deterministic dataset for a single workspace.

        Projects -> Boards -> WorkflowStatuses -> Issues -> Sprints -> Comments
        Also creates: AuditLog, Notification, Report, WebhookSubscription, WebhookDelivery
        """
        from workspaces.models import (
            Project,
            Board,
            WorkflowStatus,
            WorkflowTransition,
            Sprint,
            Issue,
            Comment,
            AuditLog,
            Notification,
            Report,
            WebhookSubscription,
            WebhookDelivery,
        )

        # Determine plan based on workspace billing
        billing = WorkspaceBilling.objects.get(workspace=workspace)
        plan_name = billing.effective_plan
        plan_limits = {"free": 5, "pro": 25}
        membership_limit = plan_limits.get(plan_name, 5)

        # 1. Create projects with boards and workflow statuses
        # Free: 1 project with 1 board; Pro: 2 projects with 2 boards
        n_projects = 2 if plan_name == "pro" else 1
        projects_created = []

        for i in range(n_projects):
            project_key = chr(ord("A") + i)
            # Check if project already exists for this workspace
            try:
                project = Project.objects.get(key=project_key, workspace=workspace)
                if project not in projects_created:
                    projects_created.append(project)
            except Project.DoesNotExist:
                project = Project.objects.create(
                    key=project_key,
                    name=f"{workspace.name} Project {chr(ord('A') + i)}",
                    description=f"Test project {chr(ord('A') + i)} for {workspace.name}",
                    workspace=workspace,
                    membership_limit=membership_limit,
                    project_limit_per_plan=5 if plan_name == "free" else 20,
                )
                projects_created.append(project)
                self.stdout.write(f"    - Created project {project_key}")

            # Create board (get_or_create to be idempotent)
            board, board_created = Board.objects.get_or_create(
                project=project,
                workspace=workspace,
                defaults={"name": f"{project.name} Board"},
            )

            # Create initial workflow statuses (To do, In progress, Done)
            statuses_created = []
            for status_name, status_display in [
                ("to_do", "To do"),
                ("in_progress", "In progress"),
                ("done", "Done"),
            ]:
                ws, created = WorkflowStatus.objects.get_or_create(
                    board=board,
                    name=status_name,
                    defaults={
                        "position": len(statuses_created),
                        "is_active": True,
                        "is_default": status_name == "to_do",
                    },
                )
                statuses_created.append(ws)

            # 2. Distribute issues between columns
            for issue_idx in range(n_projects * 2):
                status = statuses_created[issue_idx % 3]
                issue_title = f"{project.key}-{issue_idx + 1}"
                issue_description = f"Description for issue {issue_idx + 1} in {project.key}"

                issue, issue_created = Issue.objects.get_or_create(
                    number=issue_idx + 1,
                    board=board,
                    defaults={
                        "title": issue_title,
                        "description": issue_description,
                        "board": board,
                        "priority": ["low", "medium", "high"][issue_idx % 3],
                        "status_id": status,
                        "reporter": users.get("alice")
                        or users.get("bob")
                        or users.get("carol")
                        or self._get_dummy_user(),
                    },
                )

                if issue_created:
                    # Assign assignee (rotate between users)
                    assignee_idx = issue_idx % 3
                    issue_users = [
                        u for u in users.values() if u.username != "seed_owner"
                    ]
                    if issue_users:
                        selected = (
                            list(issue_users)[assignee_idx % len(issue_users)]
                        )
                        issue.assignee = selected
                        issue.save(update_fields=["assignee"])

                    # Create sprint
                    sprint_name = f"Sprint {issue_idx + 1}"
                    sprint, sprint_created = Sprint.objects.get_or_create(
                        name=sprint_name,
                        project=project,
                        workspace=workspace,
                        defaults={
                            "status": "active"
                            if issue_idx == 0
                            else "planned",
                            "start_at": None,
                            "end_at": None,
                        },
                    )

                    # Associate issue with sprint if it's the first issue
                    if sprint_created and issue_idx == 0:
                        issue.sprint_id = sprint
                        issue.save(update_fields=["sprint_id"])

                    # Create comment on issue
                    comment_author = (
                        users.get("alice")
                        or users.get("bob")
                        or users.get("carol")
                        or self._get_dummy_user()
                    )
                    Comment.objects.get_or_create(
                        issue=issue,
                        author=comment_author,
                        defaults={
                            "text": f"Initial comment on issue #{issue.number} - {issue.title}",
                        },
                    )

                # 3. Create audit events consistent with operations
                actor = users.get("alice") or users.get("bob") or users.get("carol") or self._get_dummy_user()
                AuditLog.objects.get_or_create(
                    actor=actor,
                    workspace_id=workspace.id,
                    resource_type="issue",
                    resource_id=issue.id,
                    operation="create",
                    success=True,
                    defaults={
                        "details": f"Issue created: #{issue.number} {issue.title}"
                    },
                )

                # 4. Create internal notifications
                Notification.objects.get_or_create(
                    user=actor,
                    workspace_id=workspace.id,
                    notification_type="issue_assigned",
                    entity_type="issue",
                    entity_id=issue.id,
                    defaults={
                        "payload": {
                            "issue_key": project.key,
                            "issue_title": issue.title,
                        }
                    },
                )

            # 5. Create report
            Report.objects.get_or_create(
                user=users.get("alice") or users.get("bob") or users.get("carol") or self._get_dummy_user(),
                workspace_id=workspace.id,
                report_type="issues_by_status",
                defaults={
                    "status": "pending",
                    "result": {},
                },
            )

            # 6. Create webhook subscription and delivery
            wh = WEBHOOK_SUBSCRIPTIONS[len(ensured_ws_ids) % len(WEBHOOK_SUBSCRIPTIONS)]
            sub, sub_created = WebhookSubscription.objects.get_or_create(
                workspace=workspace,
                url=wh["url"],
                defaults={
                    "events": wh["events"],
                    "is_enabled": True,
                    "signing_secret": f"whsec_fake_{workspace.id}",
                },
            )
            if sub_created:
                # Use update_or_create pattern for WebhookDelivery.
                # delivery_id is globally unique, so we try to get existing
                # delivery first, then create if not found.
                delivery_id = f"del_{workspace.id}_001"
                event_id = f"evt_{workspace.id}_001"
                try:
                    delivery = WebhookDelivery.objects.get(
                        delivery_id=delivery_id
                    )
                    # Update existing delivery to current state
                    delivery.status = "delivered"
                    delivery.attempt = 1
                    delivery.max_attempts = 3
                    delivery.event_type = "issue.created"
                    delivery.request_payload = {"issue": f"{project.key}-1"}
                    delivery.response_status = 200
                    delivery.response_body = '{"status": "ok"}'
                    delivery.save(update_fields=[
                        "status", "attempt", "max_attempts",
                        "event_type", "request_payload",
                        "response_status", "response_body",
                    ])
                except WebhookDelivery.DoesNotExist:
                    # Create new delivery - delivery_id is globally unique
                    # so different workspaces get different delivery_ids
                    WebhookDelivery.objects.create(
                        subscription=sub,
                        event_type="issue.created",
                        delivery_id=delivery_id,
                        event_id=event_id,
                        status="delivered",
                        attempt=1,
                        max_attempts=3,
                        request_payload={"issue": f"{project.key}-1"},
                        response_status=200,
                        response_body='{"status": "ok"}',
                    )

        self.stdout.write(f"    - Dataset built for workspace {workspace.id}\n")