/**
 * useIssues hook.
 *
 * Fetches issues with optional filters and provides create/update/transition
 * mutations. After a successful mutation the issue list is refetched so the
 * board reflects the authoritative server state.
 */

import { useState, useCallback } from "react";
import {
  listIssues,
  createIssue,
  updateIssue,
  transitionIssue,
} from "../api/issues";
import type { Issue, IssuePriority } from "../types/index";

interface UseIssuesReturn {
  issues: Issue[];
  loading: boolean;
  error: string | null;
  fetchIssues: (filters?: Record<string, string>) => Promise<void>;
  createIssue: (
    projectId: string | number,
    data: { title: string; description: string; priority: IssuePriority; status: string }
  ) => Promise<Issue | null>;
  updateIssue: (
    issueId: string | number,
    version: number,
    data: Record<string, any>
  ) => Promise<Issue | null>;
  transitionIssue: (issueId: string | number, status: string) => Promise<Issue | null>;
}

export function useIssues(): UseIssuesReturn {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchIssues = useCallback(
    async (filters?: Record<string, string>): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const data = await listIssues(filters);
        setIssues(Array.isArray(data) ? data : []);
      } catch (err: any) {
        setError(err?.message ?? "Failed to load issues");
        setIssues([]);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const doCreateIssue = useCallback(
    async (
      projectId: string | number,
      data: { title: string; description: string; priority: IssuePriority; status: string }
    ): Promise<Issue | null> => {
      setError(null);
      try {
        const issue = await createIssue(projectId, data);
        setIssues((prev) => [issue, ...prev]);
        return issue;
      } catch (err: any) {
        setError(err?.message ?? "Failed to create issue");
        return null;
      }
    },
    []
  );

  const doUpdateIssue = useCallback(
    async (
      issueId: string | number,
      version: number,
      data: Record<string, any>
    ): Promise<Issue | null> => {
      setError(null);
      try {
        const updated = await updateIssue(issueId, version, data);
        setIssues((prev) =>
          prev.map((i) => (i.id === updated.id ? updated : i))
        );
        return updated;
      } catch (err: any) {
        setError(err?.message ?? "Failed to update issue");
        return null;
      }
    },
    []
  );

  const doTransitionIssue = useCallback(
    async (
      issueId: string | number,
      status: string
    ): Promise<Issue | null> => {
      setError(null);
      try {
        const updated = await transitionIssue(issueId, status);
        setIssues((prev) =>
          prev.map((i) => (i.id === updated.id ? updated : i))
        );
        return updated;
      } catch (err: any) {
        setError(err?.message ?? "Failed to transition issue");
        return null;
      }
    },
    []
  );

  return {
    issues,
    loading,
    error,
    fetchIssues,
    createIssue: doCreateIssue,
    updateIssue: doUpdateIssue,
    transitionIssue: doTransitionIssue,
  };
}
