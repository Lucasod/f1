/**
 * useWorkspace hook + WorkspaceContext.
 *
 * Manages the list of accessible workspaces, the currently selected
 * workspace (persisted in localStorage), and the caller's role within it.
 * Workspace selection is explicit; the backend revalidates membership on every
 * request, so the frontend never trusts a client-supplied workspace_id for
 * authorization.
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import {
  listWorkspaces,
  createWorkspace,
} from "../api/workspaces";
import type { Workspace } from "../types/index";
import { matchPath, useLocation } from "react-router-dom";

const SELECTION_KEY = "f04_workspace_id";

interface WorkspaceContextType {
  workspaces: Workspace[];
  currentWorkspace: Workspace | null;
  currentWorkspaceId: number | null;
  currentWorkspaceRole: 'owner' | 'admin' | 'member' | null;
  loading: boolean;
  fetchWorkspaces: () => Promise<void>;
  selectWorkspace: (id: number) => Promise<void>;
  createWorkspace: (name: string) => Promise<Workspace>;
  clearSelection: () => void;
}

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(
  undefined
);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [currentWorkspace, setCurrentWorkspace] = useState<Workspace | null>(
    null
  );
  const [loading, setLoading] = useState(false);

  const fetchWorkspaces = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const data = await listWorkspaces();
      setWorkspaces(Array.isArray(data) ? data : []);
    } catch {
      setWorkspaces([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load workspaces on mount.
  useEffect(() => {
    fetchWorkspaces();
  }, [fetchWorkspaces]);

  const routeWorkspace = matchPath("/workspaces/:workspaceId/*", location.pathname)?.params.workspaceId;
  const activeWorkspace = routeWorkspace
    ? workspaces.find((workspace) => workspace.id === Number(routeWorkspace)) ?? null
    : currentWorkspace;
  const currentWorkspaceId = activeWorkspace?.id ?? null;
  const currentWorkspaceRole = activeWorkspace?.role ?? null;

  const selectWorkspace = useCallback(
    async (id: number): Promise<void> => {
      const ws = workspaces.find((w) => w.id === id);
      if (ws) {
        setCurrentWorkspace(ws);
        try {
          localStorage.setItem(SELECTION_KEY, String(id));
        } catch {
          // localStorage may be unavailable in private mode; ignore.
        }
        return;
      }
      // Not in the current list: refresh then select if accessible.
      await fetchWorkspaces();
      const found = workspaces.find((w) => w.id === id);
      if (found) {
        setCurrentWorkspace(found);
        try {
          localStorage.setItem(SELECTION_KEY, String(id));
        } catch {}
      }
    },
    [workspaces, fetchWorkspaces]
  );

  // Restore persisted selection on mount if it is still in the list.
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const persisted = localStorage.getItem(SELECTION_KEY);
        if (persisted && workspaces.length > 0) {
          const id = Number(persisted);
          if (!isNaN(id)) {
            const found = workspaces.find((w) => w.id === id);
            if (found && mounted) {
              setCurrentWorkspace(found);
            }
          }
        }
      } catch {
        // Ignore localStorage errors.
      }
    })();
    return () => {
      mounted = false;
    };
  }, [workspaces]);

  const doCreateWorkspace = useCallback(
    async (name: string): Promise<Workspace> => {
      const ws = await createWorkspace(name);
      setWorkspaces((prev) => [...prev, ws]);
      setCurrentWorkspace(ws);
      try { localStorage.setItem(SELECTION_KEY, String(ws.id)); } catch {}
      return ws;
    },
    []
  );

  const clearSelection = useCallback((): void => {
    setCurrentWorkspace(null);
    try {
      localStorage.removeItem(SELECTION_KEY);
    } catch {}
  }, []);

  const value: WorkspaceContextType = {
    workspaces,
    currentWorkspace: activeWorkspace,
    currentWorkspaceId,
    currentWorkspaceRole,
    loading,
    fetchWorkspaces,
    selectWorkspace,
    createWorkspace: doCreateWorkspace,
    clearSelection,
  };

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextType {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error("useWorkspace must be used within a WorkspaceProvider");
  }
  return ctx;
}
