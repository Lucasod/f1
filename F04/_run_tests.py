import os
import sys

# Add paths
sys.path.insert(0, '/home/workstation/source/f1/F04/backend/conf')
sys.path.insert(0, '/home/workstation/source/f1/F04/backend')
sys.path.insert(0, '/home/workstation/source/f1/F04/backend/memberships')

os.environ['DJANGO_SETTINGS_MODULE'] = 'conf.settings'

import django
django.setup()

# Now run the tests using pytest
import subprocess
test_files = [
    '/home/workstation/source/f1/F04/backend/workspaces/tests/test_auth.py',
    '/home/workstation/source/f1/F04/backend/workspaces/tests/test_workspaces.py',
    '/home/workstation/source/f1/F04/backend/workspaces/tests/test_membership.py',
    '/home/workstation/source/f1/F04/backend/workspaces/tests/test_projects.py',
]

result = subprocess.run(
    [sys.executable, '-m', 'pytest', *test_files, '-v', '--tb=short'],
    capture_output=True, text=True, cwd='/home/workstation/source/f1/F04'
)
print("STDOUT:", result.stdout)
print("STDERR:", result.stderr)
print("Return code:", result.returncode)
