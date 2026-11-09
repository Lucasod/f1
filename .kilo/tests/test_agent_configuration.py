import json
import unittest
import yaml
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
AGENT_DIR = ROOT / "F01.kilo/agents"
if not AGENT_DIR.exists():
    AGENT_DIR = ROOT / "F01.kilo/agent"


def parse_frontmatter(agent_file: Path) -> dict | None:
    """Parse YAML frontmatter from agent markdown file. Returns None if no valid frontmatter."""
    content = agent_file.read_text()
    parts = content.split("---", 2)
    if len(parts) < 3:
        return None
    try:
        return yaml.safe_load(parts[1])
    except yaml.YAMLError:
        return None


def get_task_permission(frontmatter: dict) -> dict:
    """Extract task permission from frontmatter, handling both simple and object forms."""
    task_perm = frontmatter.get("permission", {}).get("task")
    if task_perm is None:
        return {"*": "deny"}
    if isinstance(task_perm, str):
        return {"*": task_perm}
    return task_perm


class AgentConfigurationTests(unittest.TestCase):
    """Configuration tests validating agent declarations and cross-consistency.

    These tests verify static configuration only. They do not test runtime
    integration with the Kilo `task` tool.
    """

    @classmethod
    def setUpClass(cls):
        cls.kilo_config = json.loads((ROOT / "kilo.jsonc").read_text())
        cls.agent_frontmatters = {}
        for agent_file in AGENT_DIR.glob("*.md"):
            agent_name = agent_file.stem
            fm = parse_frontmatter(agent_file)
            if fm is not None:
                cls.agent_frontmatters[agent_name] = fm

    def test_kilojsonc_includes_required_rules(self):
        """kilo.jsonc must reference project rules and autonomous execution contract."""
        instructions = self.kilo_config.get("instructions", [])
        self.assertIn("F01.kilo/rules/project-rules.md", instructions)
        self.assertIn("F01.kilo/rules/autonomous-execution.md", instructions)

    def test_project_has_only_core_agents(self):
        """The project must keep only the three core agents required for implementation and review."""
        self.assertEqual(set(self.agent_frontmatters), {"code-developer", "code-reviewer", "code-orchestrator"})
        for removed_name in ("docs-specialist", "frontend-specialist", "test-engineer"):
            self.assertNotIn(removed_name, self.agent_frontmatters)
            self.assertFalse((ROOT / "F01.kilo/agents" / f"{removed_name}.md").exists())

    def test_core_skills_are_removed(self):
        """Specialist skills were consolidated into the core developer and must no longer exist as separate skills."""
        self.assertFalse((ROOT / "F01.kilo/skills/frontend-design").exists())
        self.assertFalse((ROOT / "F01.kilo/skills/mongodb-schema-design").exists())

    def test_code_agent_delegation_allowlist(self):
        """Primary `code` agent may only delegate to code-reviewer and code-orchestrator."""
        delegation = self.kilo_config["agent"]["code"]["permission"]["task"]
        self.assertEqual(delegation, {"*": "deny", "code-reviewer": "allow", "code-orchestrator": "allow"})

    def test_code_orchestrator_agent_delegation_allowlist(self):
        """code-orchestrator may only delegate to code-developer and code-reviewer."""
        fm = self.agent_frontmatters["code-orchestrator"]
        task_perm = get_task_permission(fm)
        self.assertEqual(task_perm, {"*": "deny", "code-developer": "allow", "code-reviewer": "allow"})

    def test_code_orchestrator_is_read_only(self):
        """code-orchestrator must have edit, bash, webfetch, websearch denied."""
        fm = self.agent_frontmatters["code-orchestrator"]
        perm = fm.get("permission", {})
        self.assertEqual(perm.get("edit"), "deny")
        self.assertEqual(perm.get("bash"), "deny")
        self.assertEqual(perm.get("webfetch"), "deny")
        self.assertEqual(perm.get("websearch"), "deny")
        self.assertEqual(perm.get("read"), "allow")
        self.assertEqual(perm.get("glob"), "allow")
        self.assertEqual(perm.get("grep"), "allow")
        self.assertEqual(perm.get("list"), "allow")
        self.assertEqual(fm.get("mode"), "primary")

    def test_code_developer_permissions(self):
        """code-developer must have edit and bash allow, task/webfetch/websearch deny."""
        fm = self.agent_frontmatters["code-developer"]
        perm = fm.get("permission", {})
        self.assertEqual(perm.get("edit"), "allow")
        self.assertEqual(perm.get("bash"), "allow")
        self.assertEqual(perm.get("task"), "deny")
        self.assertEqual(perm.get("webfetch"), "deny")
        self.assertEqual(perm.get("websearch"), "deny")
        self.assertEqual(perm.get("read"), "allow")
        self.assertEqual(perm.get("glob"), "allow")
        self.assertEqual(perm.get("grep"), "allow")
        self.assertEqual(perm.get("list"), "allow")
        self.assertEqual(fm.get("mode"), "subagent")

    def test_code_reviewer_permissions(self):
        """code-reviewer must be read-only with edit, bash, task denied."""
        fm = self.agent_frontmatters["code-reviewer"]
        perm = fm.get("permission", {})
        self.assertEqual(perm.get("edit"), "deny")
        self.assertEqual(perm.get("bash"), "deny")
        self.assertEqual(perm.get("task"), "deny")
        self.assertEqual(perm.get("read"), "allow")
        self.assertEqual(perm.get("glob"), "allow")
        self.assertEqual(perm.get("grep"), "allow")
        self.assertEqual(perm.get("list"), "allow")
        self.assertEqual(fm.get("mode"), "subagent")

    def test_delegation_targets_exist(self):
        """Every agent referenced in a task allowlist must have a corresponding agent file."""
        code_delegation = self.kilo_config["agent"]["code"]["permission"]["task"]
        orch_fm = self.agent_frontmatters["code-orchestrator"]
        orch_delegation = get_task_permission(orch_fm)

        all_targets = set()
        for delegation in (code_delegation, orch_delegation):
            for target, action in delegation.items():
                if target != "*" and action == "allow":
                    all_targets.add(target)

        for target in all_targets:
            self.assertIn(target, self.agent_frontmatters, f"Delegation target '{target}' has no agent file")

    def test_delegation_targets_have_compatible_mode(self):
        """Delegation targets must be subagent or primary (not hidden/internal)."""
        code_delegation = self.kilo_config["agent"]["code"]["permission"]["task"]
        orch_fm = self.agent_frontmatters["code-orchestrator"]
        orch_delegation = get_task_permission(orch_fm)

        for delegation in (code_delegation, orch_delegation):
            for target, action in delegation.items():
                if target != "*" and action == "allow":
                    target_fm = self.agent_frontmatters[target]
                    mode = target_fm.get("mode")
                    self.assertIn(mode, ("subagent", "primary"), f"Target '{target}' has invalid mode: {mode}")
                    self.assertFalse(target_fm.get("hidden", False), f"Target '{target}' is hidden")

    def test_no_divergent_task_permissions(self):
        """Task permissions in kilo.jsonc and agent frontmatters must not conflict.

        This test detects divergence where kilo.jsonc allows a delegation
        but the target agent's frontmatter would not accept it, or vice versa.
        """
        code_delegation = self.kilo_config["agent"]["code"]["permission"]["task"]
        orch_fm = self.agent_frontmatters["code-orchestrator"]
        orch_delegation = get_task_permission(orch_fm)

        code_allows = {t for t, a in code_delegation.items() if t != "*" and a == "allow"}
        orch_allows = {t for t, a in orch_delegation.items() if t != "*" and a == "allow"}

        self.assertEqual(code_allows, {"code-reviewer", "code-orchestrator"})
        self.assertEqual(orch_allows, {"code-developer", "code-reviewer"})

    def test_developer_is_implementation_agent_with_edit_and_bash(self):
        developer = (ROOT / ".kilo/agent/code-developer.md").read_text()
        frontmatter = developer.split("---", 2)[1]

        self.assertRegex(frontmatter, r"(?m)^mode:\s*subagent\s*$")
        self.assertRegex(frontmatter, r"(?m)^\s*edit:\s*allow\s*$")
        self.assertRegex(frontmatter, r"(?m)^\s*bash:\s*allow\s*$")
        self.assertRegex(frontmatter, r"(?m)^\s*task:\s*deny\s*$")
        self.assertRegex(frontmatter, r"(?m)^\s*webfetch:\s*deny\s*$")
        self.assertRegex(frontmatter, r"(?m)^\s*websearch:\s*deny\s*$")
        self.assertRegex(frontmatter, r"(?m)^\s*read:\s*allow\s*$")
        self.assertRegex(frontmatter, r"(?m)^\s*glob:\s*allow\s*$")
        self.assertRegex(frontmatter, r"(?m)^\s*grep:\s*allow\s*$")
        self.assertRegex(frontmatter, r"(?m)^\s*list:\s*allow\s*$")

    def test_orchestration_rules_define_bounded_review_and_resume(self):
        """Autonomous execution contract must define key terms."""
        rules = (ROOT / "F01.kilo/rules/autonomous-execution.md").read_text()
        for required_term in (
            "autonomous execution",
            "CORRECTIONS_NEEDED",
            "INCONCLUSIVE",
            "BLOCKED",
            "three",
            "resume",
            "append-only",
            "review",
        ):
            with self.subTest(required_term=required_term):
                self.assertIn(required_term.lower(), rules.lower())

    def test_orchestrator_is_read_only_with_developer_and_reviewer_delegation(self):
        orchestrator = (ROOT / ".kilo/agent/code-orchestrator.md").read_text()
        frontmatter = orchestrator.split("---", 2)[1]

        self.assertRegex(frontmatter, r"(?m)^mode:\s*primary\s*$")
        self.assertRegex(frontmatter, r"(?m)^\s*edit:\s*deny\s*$")
        self.assertRegex(frontmatter, r"(?m)^\s*bash:\s*deny\s*$")
        self.assertRegex(frontmatter, r"(?m)^\s*webfetch:\s*deny\s*$")
        self.assertRegex(frontmatter, r"(?m)^\s*websearch:\s*deny\s*$")
        self.assertRegex(frontmatter, r"(?m)^\s*read:\s*allow\s*$")
        self.assertRegex(frontmatter, r"(?m)^\s*glob:\s*allow\s*$")
        self.assertRegex(frontmatter, r"(?m)^\s*grep:\s*allow\s*$")
        self.assertRegex(frontmatter, r"(?m)^\s*list:\s*allow\s*$")

        self.assertRegex(frontmatter, r"(?m)^\s*task:\s*$")
        self.assertRegex(frontmatter, r"(?m)^\s+\"\*\":\s*deny\s*$")
        self.assertRegex(frontmatter, r"(?m)^\s+\"code-developer\":\s*allow\s*$")
        self.assertRegex(frontmatter, r"(?m)^\s+\"code-reviewer\":\s*allow\s*$")


    def test_secrets_protection_rule_exists(self):
        """secrets-protection.md must exist as a mandatory rule file."""
        self.assertTrue((ROOT / "F01.kilo/rules/secrets-protection.md").is_file())

    def test_secrets_protection_in_kilo_instructions(self):
        """secrets-protection.md must be listed in kilo.jsonc instructions."""
        instructions = self.kilo_config.get("instructions", [])
        self.assertIn("F01.kilo/rules/secrets-protection.md", instructions)

    def test_secrets_protection_contains_key_phrases(self):
        """secrets-protection.md must contain mandatory key phrases."""
        content = (ROOT / "F01.kilo/rules/secrets-protection.md").read_text()
        for phrase in ("Never display", "cat .env", "printenv", "precedence", "rotation"):
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, content)

    def test_rules_reference_secrets_protection(self):
        """universal-rules.md and project-rules.md must reference secrets-protection."""
        for rule_file in ("universal-rules.md", "project-rules.md"):
            content = (ROOT / "F01.kilo/rules" / rule_file).read_text()
            self.assertIn("secrets-protection.md", content)


    def test_secrets_protection_section_headings(self):
        """secrets-protection.md must contain the required section headings."""
        content = (ROOT / "F01.kilo/rules/secrets-protection.md").read_text()
        for heading in (
            "Core Prohibitions",
            "Diagnostics",
            "Repository and File Protection",
            "Suspected Exposure",
            "Secret Taxonomy",
            "Scope and Enforcement",
        ):
            with self.subTest(heading=heading):
                self.assertIn(f"## {heading}", content)

    def test_secrets_protection_taxonomy_categories(self):
        """Secret Taxonomy must list the required categories."""
        content = (ROOT / "F01.kilo/rules/secrets-protection.md").read_text()
        for category in (
            "API keys",
            "Tokens",
            "Passwords",
            "Database credentials",
            "Private keys",
            "Webhook secrets",
            "Certificates",
            "Connection strings",
            "Session cookies",
            "Authorization headers",
            "Base64-encoded secrets",
        ):
            with self.subTest(category=category):
                self.assertIn(category, content)
        self.assertIn("When in doubt, treat as secret", content)

    def test_autonomous_execution_references_secrets_protection(self):
        """autonomous-execution.md must cross-reference secrets-protection.md."""
        content = (ROOT / "F01.kilo/rules/autonomous-execution.md").read_text()
        self.assertIn("secrets-protection.md", content)
        self.assertIn("## Secrets Protection", content)

    def test_agents_reference_secrets_protection(self):
        """Each core agent must cross-reference secrets-protection.md."""
        for agent in ("code-orchestrator", "code-developer", "code-reviewer"):
            content = (ROOT / "F01.kilo/agents" / f"{agent}.md").read_text()
            with self.subTest(agent=agent):
                self.assertIn("secrets-protection.md", content)
                self.assertIn("Secrets Protection", content)


if __name__ == "__main__":
    unittest.main()