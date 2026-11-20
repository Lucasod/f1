import { request } from "./client";

export async function createReport(workspaceId: number, reportType: string): Promise<any> {
  return request("/reports/", {
    method: "POST",
    body: JSON.stringify({ workspace_id: workspaceId, report_type: reportType }),
  });
}

export async function getReport(reportId: number): Promise<any> {
  return request(`/reports/${reportId}/`);
}
