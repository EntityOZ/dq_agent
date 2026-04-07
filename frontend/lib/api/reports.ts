import apiClient from "./client";
import type { Version } from "@/types/api";

export function getReportDownloadUrl(versionId: string): string {
  return `/api/v1/reports/${versionId}/download`;
}

export async function pollVersionStatus(
  versionId: string,
  onUpdate: (status: string) => void,
  timeoutMs: number = 600_000
): Promise<string> {
  const start = Date.now();
  const TERMINAL = new Set([
    "agents_complete",
    "failed",
    "agents_failed",
  ]);

  while (Date.now() - start < timeoutMs) {
    const { data } = await apiClient.get<{ status: string }>(
      `/api/v1/versions/${versionId}/status`
    );
    onUpdate(data.status);
    if (TERMINAL.has(data.status)) {
      return data.status;
    }
    await new Promise((r) => setTimeout(r, 3_000));
  }
  throw new Error("Polling timed out");
}
