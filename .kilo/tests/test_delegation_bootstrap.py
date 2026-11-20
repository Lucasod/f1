import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

class DelegationBootstrapTests(unittest.TestCase):
    def test_delegation_return_and_origin_are_consistent(self):
        developer = (ROOT / '.kilo/agents/code-developer.md').read_text()
        orchestrator = (ROOT / '.kilo/agents/code-orchestrator.md').read_text()
        contract = (ROOT / '.kilo/fird/contratos-delegacao.md').read_text()
        self.assertIn('End with your report; the task result returns to Orchestra', developer)
        self.assertNotIn('Return the result to Orchestra through task.', developer)
        self.assertIn('user role alone does not prove direct origin', developer.lower())
        self.assertIn('INDETERMINADA', contract)
        self.assertIn('The Developer ends with its report', orchestrator)

    def test_orchestrator_prepares_missing_delegation_details(self):
        orchestrator = (ROOT / '.kilo/agents/code-orchestrator.md').read_text()
        developer = (ROOT / '.kilo/agents/code-developer.md').read_text()
        contract = (ROOT / '.kilo/fird/contratos-delegacao.md').read_text()
        self.assertIn('READ-ONLY DELEGATION PREPARATION', orchestrator)
        self.assertIn('READ-ONLY DELEGATION PREPARATION', developer)
        self.assertIn('PREPARAÇÃO DE DELEGAÇÃO SOMENTE LEITURA', contract)
        self.assertIn('does not authorize implementation', developer)
        self.assertIn('do not invent', orchestrator)

    def test_orchestrator_sends_actionable_diagnostic_and_implementation_requests(self):
        text = (ROOT / '.kilo/agents/code-orchestrator.md').read_text()
        for required in ('READ-ONLY REQUEST TEMPLATE', 'IMPLEMENTATION REQUEST TEMPLATE',
                         'source of user authorization', 'current branch and full HEAD',
                         'historical checkpoint', 'must not fabricate',
                         'no tests, writes', 'finish with a report'):
            with self.subTest(required=required):
                self.assertIn(required, text)

    def test_write_requires_authenticated_current_invocation(self):
        contract = (ROOT / '.kilo/fird/contratos-delegacao.md').read_text()
        developer = (ROOT / '.kilo/agents/code-developer.md').read_text()
        orchestrator = (ROOT / '.kilo/agents/code-orchestrator.md').read_text()
        section = contract.split('### 3.3 ', 1)[1].split('### 3.4 ', 1)[0]
        for phrase in ('INDETERMINADA', 'não autoriza escrita nem bootstrap',
                       'vínculo autenticado da chamada atual', 'somente leitura'):
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, section)
        self.assertNotIn('essa ausência, por si só, não bloqueia', section)
        self.assertIn('authenticated binding of the current invocation', developer)
        self.assertIn('authenticated binding of the current invocation', orchestrator)
        self.assertNotIn('Unavailable provenance metadata alone does not block', developer)

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
