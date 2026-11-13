/**
 * index.tsx — React application entry point.
 *
 * Sets up the router, global providers (Auth + Workspace), and routes:
 *   /login                                              — sign in
 *   /workspaces                                         — workspace list
 *   /workspaces/:workspaceId/projects                   — project list
 *   /workspaces/:workspaceId/projects/:projectId/board  — Kanban board
 *
 * A top bar shows the WorkspaceSelector and LogoutButton once authenticated.
 */

import React from "react";
import ReactDOM from "react-dom/client";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useNavigate,
  useLocation,
  useParams,
} from "react-router-dom";
import { RootStoreProvider } from "./stores/rootStore";
import { useAuth } from "./hooks/useAuth";
import { LoginForm } from "./components/auth/LoginForm";
import { LogoutButton } from "./components/auth/LogoutButton";
import { WorkspaceSelector } from "./components/workspace/WorkspaceSelector";
import { WorkspaceList } from "./components/workspace/WorkspaceList";
import { WorkspaceCreateModal } from "./components/workspace/WorkspaceCreateModal";
import { ProjectList } from "./components/project/ProjectList";
import { ProjectCreateModal } from "./components/project/ProjectCreateModal";
import { BoardPage } from "./components/board/BoardPage";
import { ErrorBoundary } from "./components/shared/ErrorBoundary";
import { NotificationList } from "./components/notifications/NotificationList";
import { ReportList } from "./components/reports/ReportList";
import { WebhookList } from "./components/webhooks/WebhookList";

/**
 * TopBar — persistent header shown on every page.
 */
function TopBar() {
  const { isAuthenticated, checking } = useAuth();

  // Render nothing while the session is being restored from /auth/me/.
  if (checking) return null;

  if (!isAuthenticated) {
    return (
      <header className="top-bar top-bar--guest">
        <a href="/login" className="top-bar__brand">
          ProjectBoard
        </a>
      </header>
    );
  }

  return (
    <header className="top-bar">
      <a href="/workspaces" className="top-bar__brand">
        ProjectBoard
      </a>
      <div className="top-bar__controls">
        <WorkspaceSelector />
        <LogoutButton />
      </div>
    </header>
  );
}

/**
 * RequireAuth — renders children only when authenticated; otherwise redirects
 * to /login, preserving the intended destination in location state.
 */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, checking } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  if (checking) return null;
  if (!isAuthenticated) {
    navigate("/login", { replace: true, state: { from: location } });
    return null;
  }
  return <>{children}</>;
}

/**
 * WorkspacesRoute — workspace list with create modal.
 */
function WorkspacesRoute() {
  const [createOpen, setCreateOpen] = React.useState(false);
  return (
    <div className="page workspaces-page">
      <h1>Workspaces</h1>
      <WorkspaceList />
      <WorkspaceCreateModal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
      />
    </div>
  );
}

/**
 * ProjectsRoute — project list for the selected workspace.
 */
function ProjectsRoute() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const [createOpen, setCreateOpen] = React.useState(false);
  const id = workspaceId ? Number(workspaceId) : null;
  return (
    <div className="page projects-page">
      <h1>Projects</h1>
      <ProjectList workspaceId={id} />
      {id != null && (
        <ProjectCreateModal
          workspaceId={id}
          isOpen={createOpen}
          onClose={() => setCreateOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * BoardRoute — Kanban board for the selected project.
 */
function BoardRoute() {
  const { projectId } = useParams<{ projectId: string }>();
  const id = projectId ? Number(projectId) : null;
  return (
    <div className="page board-page">
      <h1>Board</h1>
      <BoardPage projectId={id} />
    </div>
  );
}

/**
 * NotificationsRoute — notification list for the selected workspace.
 */
function NotificationsRoute() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const id = workspaceId ? Number(workspaceId) : null;
  return (
    <div className="page notifications-page">
      <h1>Notifications</h1>
      {id != null ? <NotificationList /> : <div>Select a workspace.</div>}
    </div>
  );
}

/**
 * ReportsRoute — report list for the selected workspace.
 */
function ReportsRoute() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const id = workspaceId ? Number(workspaceId) : null;
  return (
    <div className="page reports-page">
      <h1>Reports</h1>
      {id != null ? <ReportList /> : <div>Select a workspace.</div>}
    </div>
  );
}

/**
 * WebhooksRoute — webhook list for the selected workspace.
 */
function WebhooksRoute() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const id = workspaceId ? Number(workspaceId) : null;
  return (
    <div className="page webhooks-page">
      <h1>Webhooks</h1>
      {id != null ? <WebhookList /> : <div>Select a workspace.</div>}
    </div>
  );
}

/**
 * LoginRoute — sign in, redirecting to /workspaces when already authenticated.
 */
function LoginRoute() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  if (isAuthenticated) {
    navigate("/workspaces", { replace: true });
    return null;
  }
  return <LoginForm />;
}

function App() {
  return (
    <ErrorBoundary>
      <TopBar />
      <main className="app">
        <Routes>
          <Route path="/login" element={<LoginRoute />} />
          <Route
            path="/workspaces"
            element={
              <RequireAuth>
                <WorkspacesRoute />
              </RequireAuth>
            }
          />
          <Route
            path="/workspaces/:workspaceId/projects"
            element={
              <RequireAuth>
                <ProjectsRoute />
              </RequireAuth>
            }
          />
          <Route
            path="/workspaces/:workspaceId/projects/:projectId/board"
            element={
              <RequireAuth>
                <BoardRoute />
              </RequireAuth>
            }
          />
          <Route
            path="/workspaces/:workspaceId/notifications"
            element={
              <RequireAuth>
                <NotificationsRoute />
              </RequireAuth>
            }
          />
          <Route
            path="/workspaces/:workspaceId/reports"
            element={
              <RequireAuth>
                <ReportsRoute />
              </RequireAuth>
            }
          />
          <Route
            path="/workspaces/:workspaceId/webhooks"
            element={
              <RequireAuth>
                <WebhooksRoute />
              </RequireAuth>
            }
          />
          <Route path="/" element={<Navigate to="/workspaces" replace />} />
        </Routes>
      </main>
    </ErrorBoundary>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <RootStoreProvider>
        <App />
      </RootStoreProvider>
    </BrowserRouter>
  </React.StrictMode>
);
