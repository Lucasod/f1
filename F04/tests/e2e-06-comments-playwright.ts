/// <reference types="playwright/test" />
import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';

const BASE_URL = 'http://127.0.0.1:8000/api/v1';

// Credentials from .env: SECRET_TEST_PASS=testpass123
const VALID_CREDENTIALS = {
  username: 'alice',
  password: process.env.SECRET_TEST_PASS || 'testpass123',
};

// Helper functions shared across tests
async function createIssue(request, projectId, title, csrfToken) {
  const resp = await request.post(BASE_URL + '/projects/' + projectId + '/issues/', {
    data: { title },
    headers: { 'X-CSRFToken': csrfToken as string, 'Content-Type': 'application/json' }
  });
  return resp;
}

async function listComments(request, issueId, csrfToken) {
  const resp = await request.get(BASE_URL + '/issues/' + issueId + '/comments/', {
    headers: { 'X-CSRFToken': csrfToken as string, 'Content-Type': 'application/json' }
  });
  return resp;
}

async function createComment(request, issueId, text, csrfToken) {
  const resp = await request.post(BASE_URL + '/issues/' + issueId + '/comments/', {
    data: { text },
    headers: { 'X-CSRFToken': csrfToken as string, 'Content-Type': 'application/json' }
  });
  return resp;
}

async function deleteComment(request, commentId, csrfToken) {
  const resp = await request.delete(BASE_URL + '/comments/' + commentId + '/', {
    headers: { 'X-CSRFToken': csrfToken as string, 'Content-Type': 'application/json' }
  });
  return resp;
}

// Hard-delete any workspaces owned by the given user.
// Free plan allows only ONE workspace. Soft-delete via the API does NOT free
// the slot because create_workspace counts every owned workspace regardless
// of deleted_at, so we hard-delete via the Django ORM to reset the ownership
// count before a test creates a new workspace.
async function deleteUserWorkspaces(username: string) {
  execSync(
    'DB_ENGINE=django.db.backends.postgresql POSTGRES_DB=f04 POSTGRES_USER=f04 POSTGRES_PASSWORD=ww3Nn^kOp3zRc1 POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=5433 DJANGO_SETTINGS_MODULE=conf.settings PYTHONPATH=backend python3 << "PYEOF"\nimport os\nimport django\nos.environ.setdefault("DJANGO_SETTINGS_MODULE", "conf.settings")\ndjango.setup()\nfrom django.contrib.auth import get_user_model\nfrom workspaces.models import Workspace\nUser = get_user_model()\nuser = User.objects.filter(username="' + username + '").first()\nif user:\n  for ws in Workspace.objects.filter(memberships__user=user, memberships__role="owner").distinct():\n    ws.delete()\nPYEOF'
  );
}

// -- test.beforeAll: fetch initial CSRF token --
test.beforeAll(async ({ request }, testInfo) => {
  const csrfResponse = await request.get(BASE_URL + '/auth/csrf/');
  const csrfBody = await csrfResponse.json();
  testInfo.csrfToken = csrfBody.csrf_token;
});

// -- Test suite: Comments E2E --
test.describe('Comments E2E', () => {
  test('1. Create Comment - POST /api/v1/issues/{issue_id}/comments/ with text', async ({ request }, testInfo) => {
    let csrfToken = testInfo.csrfToken;
    // Login as alice
    await request.post(BASE_URL + '/auth/login/', {
      data: VALID_CREDENTIALS,
      headers: {
        'X-CSRFToken': csrfToken as string,
        'Content-Type': 'application/json',
      },
    });
    // Fetch fresh CSRF token after login
    const freshCsrfResponse = await request.get(BASE_URL + '/auth/csrf/');
    const freshCsrfBody = await freshCsrfResponse.json();
    csrfToken = freshCsrfBody.csrf_token;

    // Create a workspace and project first (comment creation requires membership)
    // Free plan allows only ONE workspace; hard-delete any Alice owns from a prior run
    await deleteUserWorkspaces('alice');
    const workspaceResp = await request.post(BASE_URL + '/workspaces/create/', {
      data: { name: 'Comment Test Workspace' },
      headers: { 'X-CSRFToken': csrfToken as string, 'Content-Type': 'application/json' }
    });
    expect(workspaceResp.status()).toBe(201);
    const workspaceBody = await workspaceResp.json();
    const workspaceId = workspaceBody.workspace.id;

    const createProjectResp = await request.post(BASE_URL + '/projects/create/', {
      data: { name: 'Comment Test Project', key: 'CTP', workspace_id: workspaceId },
      headers: { 'X-CSRFToken': csrfToken as string, 'Content-Type': 'application/json' }
    });
    expect(createProjectResp.status()).toBe(201);
    const projectBody = await createProjectResp.json();
    const projectId = projectBody.project.id;

    // Create an issue
    const createIssueResp = await createIssue(request, projectId, 'Issue for comment testing', csrfToken);
    expect(createIssueResp.status()).toBe(201);
    const issueBody = await createIssueResp.json();
    const issueId = issueBody.issue.id;

    // Create a comment with valid text
    const resp = await createComment(request, issueId, 'This is a test comment', csrfToken);

    // Assert status code 201
    expect(resp.status()).toBe(201);

    // Assert response structure
    const body = await resp.json();
    expect(body).toHaveProperty('error', null);
    expect(body).toHaveProperty('comment');
    expect(body.comment).toHaveProperty('id');
    expect(body.comment).toHaveProperty('issue');
    expect(body.comment).toHaveProperty('author');
    expect(body.comment).toHaveProperty('author_username');
    expect(body.comment).toHaveProperty('text', 'This is a test comment');
    expect(body.comment).toHaveProperty('created_at');
    expect(body.comment).toHaveProperty('is_active', true);

    // Cleanup: delete the comment created in this test
    const deleteResp = await deleteComment(request, body.comment.id, csrfToken);
    expect(deleteResp.status()).toBe(204);
  });

  test('2. List Comments - GET /api/v1/issues/{issue_id}/comments/', async ({ request }, testInfo) => {
    let csrfToken = testInfo.csrfToken;
    // Login as alice
    await request.post(BASE_URL + '/auth/login/', {
      data: VALID_CREDENTIALS,
      headers: {
        'X-CSRFToken': csrfToken as string,
        'Content-Type': 'application/json',
      },
    });
    // Fetch fresh CSRF token after login
    const freshCsrfResponse = await request.get(BASE_URL + '/auth/csrf/');
    const freshCsrfBody = await freshCsrfResponse.json();
    csrfToken = freshCsrfBody.csrf_token;

    // Create a workspace and project first
    // Free plan allows only ONE workspace; hard-delete any Alice owns from a prior run
    await deleteUserWorkspaces('alice');
    const workspaceResp = await request.post(BASE_URL + '/workspaces/create/', {
      data: { name: 'Comment List Workspace' },
      headers: { 'X-CSRFToken': csrfToken as string, 'Content-Type': 'application/json' }
    });
    expect(workspaceResp.status()).toBe(201);
    const workspaceBody = await workspaceResp.json();
    const workspaceId = workspaceBody.workspace.id;

    const createProjectResp = await request.post(BASE_URL + '/projects/create/', {
      data: { name: 'Comment List Project', key: 'CLP', workspace_id: workspaceId },
      headers: { 'X-CSRFToken': csrfToken as string, 'Content-Type': 'application/json' }
    });
    expect(createProjectResp.status()).toBe(201);
    const projectBody = await createProjectResp.json();
    const projectId = projectBody.project.id;

    // Create an issue
    const createIssueResp = await createIssue(request, projectId, 'Issue for listing comments', csrfToken);
    expect(createIssueResp.status()).toBe(201);
    const issueBody = await createIssueResp.json();
    const issueId = issueBody.issue.id;

    // Create a comment first
    const createCommentResp = await createComment(request, issueId, 'Existing comment to list', csrfToken);
    const commentId = (await createCommentResp.json()).comment.id;

    // List comments
    const resp = await listComments(request, issueId, csrfToken);

    // Assert status code 200
    expect(resp.status()).toBe(200);

    // Assert response structure
    const body = await resp.json();
    expect(body).toHaveProperty('error', null);
    expect(body).toHaveProperty('results');
    expect(Array.isArray(body.results)).toBe(true);
    // Should see at least the comment we created
    const commentTexts = body.results.map((c: any) => c.text);
    expect(commentTexts).toContain('Existing comment to list');

    // Cleanup: delete the comment created in this test
    const deleteResp = await deleteComment(request, commentId, csrfToken);
    expect(deleteResp.status()).toBe(204);
  });

  test('3. Delete Comment - DELETE /api/v1/comments/{comment_id}/', async ({ request }, testInfo) => {
    let csrfToken = testInfo.csrfToken;
    // Login as alice
    await request.post(BASE_URL + '/auth/login/', {
      data: VALID_CREDENTIALS,
      headers: {
        'X-CSRFToken': csrfToken as string,
        'Content-Type': 'application/json',
      },
    });
    // Fetch fresh CSRF token after login
    const freshCsrfResponse = await request.get(BASE_URL + '/auth/csrf/');
    const freshCsrfBody = await freshCsrfResponse.json();
    csrfToken = freshCsrfBody.csrf_token;

    // Create a workspace and project first
    // Free plan allows only ONE workspace; hard-delete any Alice owns from a prior run
    await deleteUserWorkspaces('alice');
    const workspaceResp = await request.post(BASE_URL + '/workspaces/create/', {
      data: { name: 'Comment Delete Workspace' },
      headers: { 'X-CSRFToken': csrfToken as string, 'Content-Type': 'application/json' }
    });
    expect(workspaceResp.status()).toBe(201);
    const workspaceBody = await workspaceResp.json();
    const workspaceId = workspaceBody.workspace.id;

    const createProjectResp = await request.post(BASE_URL + '/projects/create/', {
      data: { name: 'Comment Delete Project', key: 'CDP', workspace_id: workspaceId },
      headers: { 'X-CSRFToken': csrfToken as string, 'Content-Type': 'application/json' }
    });
    expect(createProjectResp.status()).toBe(201);
    const projectBody = await createProjectResp.json();
    const projectId = projectBody.project.id;

    // Create an issue
    const createIssueResp = await createIssue(request, projectId, 'Issue for comment deletion', csrfToken);
    expect(createIssueResp.status()).toBe(201);
    const issueBody = await createIssueResp.json();
    const issueId = issueBody.issue.id;

    // Create a comment
    const createResp = await createComment(request, issueId, 'Comment to be deleted', csrfToken);
    const createBody = await createResp.json();
    const commentId = createBody.comment.id;

    // Delete the comment
    const resp = await deleteComment(request, commentId, csrfToken);

    // Assert status code 204
    expect(resp.status()).toBe(204);

    // Assert response has no body or empty
    const body = await resp.json().catch(() => ({}));
    expect(body).toEqual({});
  });

  test('4. Comment Authorization - verify non-members cannot create/delete', async ({ request }, testInfo) => {
    // Create Bob user via Django ORM (same pattern as e2e-02)
    execSync(
      'DB_ENGINE=django.db.backends.postgresql POSTGRES_DB=f04 POSTGRES_USER=f04 POSTGRES_PASSWORD=ww3Nn^kOp3zRc1 POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=5433 DJANGO_SETTINGS_MODULE=conf.settings PYTHONPATH=backend python3 << "PYEOF"\nimport os\nimport django\nos.environ.setdefault("DJANGO_SETTINGS_MODULE", "conf.settings")\ndjango.setup()\nfrom django.contrib.auth import get_user_model\nUser = get_user_model()\nUser.objects.get_or_create(username="bob", defaults={"email": "bob@example.com", "password": "testpass123"})\nPYEOF'
    );

    const BOB_CREDENTIALS = { username: 'bob', password: process.env.SECRET_TEST_PASS || 'testpass123' };

    let csrfToken = testInfo.csrfToken;

    // Login as alice
    await request.post(BASE_URL + '/auth/login/', {
      data: VALID_CREDENTIALS,
      headers: {
        'X-CSRFToken': csrfToken as string,
        'Content-Type': 'application/json',
      },
    });
    // Fetch fresh CSRF token after login
    const freshCsrfResponse = await request.get(BASE_URL + '/auth/csrf/');
    const freshCsrfBody = await freshCsrfResponse.json();
    csrfToken = freshCsrfBody.csrf_token;

    // Alice creates workspace
    // Free plan allows only ONE workspace; hard-delete any Alice owns from a prior run
    await deleteUserWorkspaces('alice');
    const workspaceResp = await request.post(BASE_URL + '/workspaces/create/', {
      data: { name: 'Auth Test Workspace' },
      headers: { 'X-CSRFToken': csrfToken as string, 'Content-Type': 'application/json' }
    });
    expect(workspaceResp.status()).toBe(201);
    const workspaceBody = await workspaceResp.json();
    const workspaceId = workspaceBody.workspace.id;

    // Alice creates project
    const projectResp = await request.post(BASE_URL + '/projects/create/', {
      data: { name: 'Auth Test Project', key: 'ATX', workspace_id: workspaceId },
      headers: { 'X-CSRFToken': csrfToken as string, 'Content-Type': 'application/json' }
    });
    expect(projectResp.status()).toBe(201);
    const projectBody = await projectResp.json();
    const projectId = projectBody.project.id;

    // Alice creates issue
    const issueResp = await createIssue(request, projectId, 'Auth Test Issue', csrfToken);
    expect(issueResp.status()).toBe(201);
    const issueBody = await issueResp.json();
    const issueId = issueBody.issue.id;

    // Alice creates comment
    const commentResp = await createComment(request, issueId, 'Comment by alice', csrfToken);
    expect(commentResp.status()).toBe(201);
    const commentBody = await commentResp.json();
    const commentId = commentBody.comment.id;

    // Login as bob (authenticated non-member)
    const bobLoginResp = await request.post(BASE_URL + '/auth/login/', {
      data: BOB_CREDENTIALS,
      headers: { 'X-CSRFToken': csrfToken as string, 'Content-Type': 'application/json' },
    });
    expect(bobLoginResp.status()).toBe(200);
    const bobCsrfResp = await request.get(BASE_URL + '/auth/csrf/');
    const bobCsrfBody = await bobCsrfResp.json();
    const bobCsrfToken = bobCsrfBody.csrf_token;

    // Bob tries to create a comment on Alice's issue → 403 (authenticated non-member)
    const respCreate = await request.post(BASE_URL + '/issues/' + issueId + '/comments/', {
      data: { text: 'comment by bob' },
      headers: { 'X-CSRFToken': bobCsrfToken as string, 'Content-Type': 'application/json' }
    });
    expect(respCreate.status()).toBe(403);

    // Bob tries to delete Alice's comment → 403 (authenticated non-member)
    const respDelete = await request.delete(BASE_URL + '/comments/' + commentId + '/', {
      headers: { 'X-CSRFToken': bobCsrfToken as string, 'Content-Type': 'application/json' }
    });
    expect(respDelete.status()).toBe(403);
  });

  test('5. Comment Content Validation - verify blank text rejection', async ({ request }, testInfo) => {
    let csrfToken = testInfo.csrfToken;
    // Login as alice
    await request.post(BASE_URL + '/auth/login/', {
      data: VALID_CREDENTIALS,
      headers: {
        'X-CSRFToken': csrfToken as string,
        'Content-Type': 'application/json',
      },
    });
    // Fetch fresh CSRF token after login
    const freshCsrfResponse = await request.get(BASE_URL + '/auth/csrf/');
    const freshCsrfBody = await freshCsrfResponse.json();
    csrfToken = freshCsrfBody.csrf_token;

    // Create a workspace and project first
    // Free plan allows only ONE workspace; hard-delete any Alice owns from a prior run
    await deleteUserWorkspaces('alice');
    const workspaceResp = await request.post(BASE_URL + '/workspaces/create/', {
      data: { name: 'Validation Workspace' },
      headers: { 'X-CSRFToken': csrfToken as string, 'Content-Type': 'application/json' }
    });
    expect(workspaceResp.status()).toBe(201);
    const workspaceBody = await workspaceResp.json();
    const workspaceId = workspaceBody.workspace.id;

    const createProjectResp = await request.post(BASE_URL + '/projects/create/', {
      data: { name: 'Validation Project', key: 'VLX', workspace_id: workspaceId },
      headers: { 'X-CSRFToken': csrfToken as string, 'Content-Type': 'application/json' }
    });
    expect(createProjectResp.status()).toBe(201);
    const projectBody = await createProjectResp.json();
    const projectId = projectBody.project.id;

    // Create an issue
    const createIssueResp = await createIssue(request, projectId, 'Issue for validation testing', csrfToken);
    expect(createIssueResp.status()).toBe(201);
    const issueBody = await createIssueResp.json();
    const issueId = issueBody.issue.id;

    // Try to create a comment with blank text
    const resp = await createComment(request, issueId, '', csrfToken);

    // Assert status code 400 (blank text rejection)
    expect(resp.status()).toBe(400);

    // Assert response structure has error (supports both {"error": ...} and {"text": [...]} formats)
    const body = await resp.json();
    expect("error" in body || "text" in body).toBe(true);
    // The error should contain validation information about the text field
    if (body.error) {
      expect(body.error).toHaveProperty('code', 'validation_error');
    } else if (body.text) {
      expect(body.text[0]).toContain('blank');
    }
  });

  test('6. Comment Authorization - unauthenticated access rejected', async ({ request }) => {
    // No login - unauthenticated user tries to create comment
    const respCreate = await request.post(BASE_URL + '/issues/999/comments/', {
      data: { text: 'comment by unauthenticated' },
      headers: { 'Content-Type': 'application/json' }
    });
    expect(respCreate.status()).toBe(403);

    // Unauthenticated user tries to delete comment
    const respDelete = await request.delete(BASE_URL + '/comments/999/', {
      headers: { 'Content-Type': 'application/json' }
    });
    expect(respDelete.status()).toBe(403);

    // Unauthenticated user tries to list comments
    const respList = await request.get(BASE_URL + '/issues/999/comments/', {
      headers: { 'Content-Type': 'application/json' }
    });
    expect(respList.status()).toBe(403);
  });
});