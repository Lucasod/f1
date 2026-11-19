import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class ReviewEvidenceContractTests(unittest.TestCase):
    def test_empty_findings_alone_never_entitle_pass(self):
        files = [
            '.kilo/fird/contratos-delegacao.md',
            '.kilo/fird/guidelines-developer.md',
            '.kilo/fird/guidelines-orchestrator.md',
            '.kilo/fird/guidelines-reviewer.md',
            '.kilo/agents/code-developer.md',
            '.kilo/agents/code-reviewer.md',
        ]
        for name in files:
            with self.subTest(name=name):
                self.assertNotIn('`PASS` ⇔', (ROOT / name).read_text())

    def test_review_requires_independent_evidence_for_pass(self):
        contract = (ROOT / '.kilo/fird/contratos-delegacao.md').read_text()
        reviewer = (ROOT / '.kilo/agents/code-reviewer.md').read_text()
        guide = (ROOT / '.kilo/fird/guidelines-reviewer.md').read_text()
        self.assertIn('evidência independente suficiente', contract)
        self.assertIn('independently verifiable evidence', reviewer)
        self.assertIn('evidência verificável independentemente', guide)
        self.assertIn('INCONCLUSIVE', reviewer)
        self.assertNotIn('the review must rely on diffs and file contents provided', reviewer)
        self.assertNotIn('depender de diffs/conteúdos fornecidos', guide)
        self.assertNotIn('prefer `INCONCLUSIVE`/`BLOCKED` over `PASS`', reviewer)
        self.assertNotIn('preferir `INCONCLUSIVE`/`BLOCKED` sobre `PASS`', guide)
        for name in ('guidelines-developer.md', 'guidelines-reviewer.md'):
            self.assertNotIn('Tratar o relatório como evidência;', (ROOT / '.kilo/fird' / name).read_text())


if __name__ == '__main__':
    unittest.main()
