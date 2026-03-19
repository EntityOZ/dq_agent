import apiClient from "./client";
import type { UploadResponse } from "@/types/api";

/* ─── Column matching types ─── */

export interface ColumnMapping {
  source_column: string;
  target_field: string | null;
  confidence: number;
  is_required: boolean;
  match_type: string;
}

export interface MatchResponse {
  detected_module: string;
  module_confidence: number;
  module_label: string;
  mappings: ColumnMapping[];
  unmapped_required: string[];
  available_modules: { value: string; label: string }[];
}

/**
 * Send column headers + sample rows to the backend for AI-powered module
 * detection and column-to-TABLE.FIELD mapping.
 */
export async function matchColumns(
  headers: string[],
  sampleRows: string[][],
  filename: string,
  moduleHint?: string
): Promise<MatchResponse> {
  const { data } = await apiClient.post<MatchResponse>("/api/v1/upload/match", {
    headers,
    sample_rows: sampleRows,
    filename,
    module_hint: moduleHint ?? null,
  });
  return data;
}

/* ─── File upload ─── */

export async function uploadFile(
  file: File,
  module: string,
  columnMapping: Record<string, string> | null,
  onProgress: (pct: number) => void,
  signal?: AbortSignal
): Promise<UploadResponse> {
  const form = new FormData();
  form.append("file", file);
  form.append("module", module);
  if (columnMapping) {
    form.append("column_mapping", JSON.stringify(columnMapping));
  }

  const { data } = await apiClient.post<UploadResponse>(
    "/api/v1/upload",
    form,
    {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 300_000, // 5 min for large uploads
      signal,
      onUploadProgress: (e) => {
        if (e.total) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      },
    }
  );
  return data;
}
