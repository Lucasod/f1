import json
import unittest
import yaml
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
AGENT_DIR = ROOT / ".kilo/agent"


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
        self.assertIn(".kilo/rules/project-rules.md", instructions)
        self.assertIn(".kilo/rules/autonomous-execution.md", instructions)

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

    def test_orchestration_rules_define_bounded_review_and_resume(self):
        """Autonomous execution contract must define key terms."""
        rules = (ROOT / ".kilo/rules/autonomous-execution.md").read_text()
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


if __name__ == "__main__":
    unittest.main()