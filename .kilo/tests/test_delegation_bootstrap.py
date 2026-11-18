import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

class DelegationBootstrapTests(unittest.TestCase):
    def test_implementation_is_scoped_and_security_permissions_stay_protected(self):
        text = (ROOT / '.kilo/agents/code-developer.md').read_text()
        self.assertNotIn('Do not modify application code or security permissions.', text)
        self.assertIn('Implement application code only within the authorized delegation', text)
        self.assertIn('Do not modify security permissions', text)

    def test_bootstrap_is_bounded_and_referenced_by_developer_guidance(self):
        contract = (ROOT / '.kilo/fird/contratos-delegacao.md').read_text()
        guide = (ROOT / '.kilo/fird/guidelines-developer.md').read_text()
        for phrase in ('PRODUCT-RUN-BOOTSTRAP', 'somente criar', 'sete seções', 'autorização humana', 'sem sobrescrever', 'edit: ask', 'BLOCKED', 'delegação separada'):
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, contract)
        self.assertIn('PRODUCT-RUN-BOOTSTRAP', guide)

if __name__ == '__main__':
    unittest.main()
