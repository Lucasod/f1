/**
 * rootStore.ts
 *
 * Composition point for global state providers. The project uses React
 * Context + custom hooks (per the KISS guideline in IMPLEMENTATION_PLAN.md)
 * rather than Redux/Jotai, so this file simply composes the providers used by
 * the application.
 */

import type { ReactNode } from "react";
import { AuthProvider } from "../hooks/useAuth";
import { WorkspaceProvider } from "../hooks/useWorkspace";

/** Root store provider composing Auth and Workspace contexts. */
export function RootStoreProvider({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <WorkspaceProvider>{children}</WorkspaceProvider>
    </AuthProvider>
  );
}

export default {
  RootStoreProvider,
};
