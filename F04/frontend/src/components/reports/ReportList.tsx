/**
 * ReportList.tsx
 *
 * Lists the current user's reports for the selected workspace.
 * Supports creating new reports and viewing completed results.
 */

import { useState, useEffect, useCallback } from "react";
import { useWorkspace } from "../../hooks/useWorkspace";
import { createReport, getReport } from "../../api/reports";
import { LoadingSpinner } from "../shared/LoadingSpinner";
import { EmptyState } from "../shared/EmptyState";

interface Report {
  id: number;
  report_type: string;
  status: string;
  result: Record<string, any>;
  error: string;
  created_at: string;
  completed_at: string | null;
}

const REPORT_TYPES = [
  { value: "issues_by_status", label: "Issues by Status" },
  { value: "issues_by_assignee", label: "Issues by Assignee" },
  { value: "sprint_completion", label: "Sprint Completion" },
  { value: "project_progress", label: "Project Progress" },
];

export function ReportList() {
  const { currentWorkspaceId } = useWorkspace();
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [reportType, setReportType] = useState(REPORT_TYPES[0].value);

  const loadReports = useCallback(async () => {
    if (!currentWorkspaceId) return;
    setLoading(true);
    setError(null);
    try {
      // Note: The backend create_report endpoint returns the created report.
      // For listing, we would need a list endpoint; for now we show reports
      // created in this session. A full list endpoint would need backend support.
      setReports([]);
    } catch (err: any) {
      setError(err?.message ?? "Failed to load reports");
    } finally {
      setLoading(false);
    }
  }, [currentWorkspaceId]);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  const handleCreateReport = async () => {
    if (!currentWorkspaceId) return;
    setCreating(true);
    setError(null);
    try {
      const report = await createReport(currentWorkspaceId, reportType);
      setReports((prev) => [report, ...prev]);
    } catch (err: any) {
      setError(err?.message ?? "Failed to create report");
    } finally {
      setCreating(false);
    }
  };

  const handleViewReport = async (id: number) => {
    try {
      const report = await getReport(id);
      setReports((prev) =>
        prev.map((r) => (r.id === id ? { ...r, ...report } : r))
      );
    } catch (err: any) {
      setError(err?.message ?? "Failed to load report details");
    }
  };

  if (loading && reports.length === 0) {
    return <LoadingSpinner label="Loading reports…" />;
  }

  return (
    <div className="report-list">
      <h2 className="report-list__title">Reports</h2>
      {error && (
        <div className="report-list__error" role="alert">
          {error}
        </div>
      )}
      <div className="report-list__create">
        <form
          className="report-list__create-form"
          onSubmit={(e) => {
            e.preventDefault();
            handleCreateReport();
          }}
          noValidate
        >
          <select
            className="report-list__type-select"
            value={reportType}
            onChange={(e) => setReportType(e.target.value)}
            aria-label="Report type"
          >
            {REPORT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <button
            className="report-list__create-submit"
            type="submit"
            disabled={creating}
          >
            {creating ? "Generating…" : "Generate Report"}
          </button>
        </form>
      </div>
      {reports.length === 0 && (
        <EmptyState
          title="No reports yet"
          message="Generate a report to see insights about your workspace."
          icon="📊"
        />
      )}
      {reports.length > 0 && (
        <ul className="report-list__list" role="list">
          {reports.map((r) => (
            <li key={r.id} className={`report-list__item report-list__item--${r.status}`}>
              <div className="report-list__info">
                <span className="report-list__type">{r.report_type}</span>
                <span className="report-list__status">{r.status}</span>
                <span className="report-list__time">{new Date(r.created_at).toLocaleString()}</span>
              </div>
              <button
                className="report-list__view"
                onClick={() => handleViewReport(r.id)}
                type="button"
                disabled={r.status === "pending"}
                aria-label={`View report ${r.id}`}
              >
                {r.status === "pending" ? "Pending…" : "View"}
              </button>
              {r.status === "completed" && r.result && (
                <div className="report-list__result">
                  <pre>{JSON.stringify(r.result, null, 2)}</pre>
                </div>
              )}
              {r.status === "failed" && r.error && (
                <div className="report-list__error">
                  Report failed: {r.error}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
