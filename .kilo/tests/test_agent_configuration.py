import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


class AgentConfigurationTests(unittest.TestCase):
    def test_project_configuration_loads_project_rules_and_limits_code_delegation(self):
        config = json.loads((ROOT / "kilo.jsonc").read_text())

        self.assertIn(".kilo/rules/project-rules.md", config["instructions"])
        self.assertIn(".kilo/rules/autonomous-execution.md", config["instructions"])
        delegation = config["agent"]["code"]["permission"]["task"]
        self.assertEqual(delegation, {"*": "deny", "code-reviewer": "allow", "code-orchestrator": "allow"})

    def test_reviewer_is_delegated_read_only_agent(self):
        reviewer = (ROOT / ".kilo/agent/code-reviewer.md").read_text()
        frontmatter = reviewer.split("---", 2)[1]

        self.assertRegex(frontmatter, r"(?m)^mode:\s*subagent\s*$")
        self.assertRegex(frontmatter, r"(?m)^\s*edit:\s*deny\s*$")
        self.assertRegex(frontmatter, r"(?m)^\s*task:\s*deny\s*$")
        self.assertRegex(frontmatter, r"(?m)^\s*bash:\s*deny\s*$")

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


if __name__ == "__main__":
    unittest.main()
