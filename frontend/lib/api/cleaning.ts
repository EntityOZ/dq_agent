import apiClient from "./client";

// ── Types ────────────────────────────────────────────────────────────────────

export interface CleaningQueueItem {
  id: string;
  object_type: string;
  status: string;
  confidence: number;
  record_key: string;
  priority: number;
  detected_at: string;
  applied_at: string | null;
  rollback_deadline: string | null;
  rule_id: string | null;
  batch_id: string | null;
  version_id: string | null;
  merge_preview: Record<string, { a: string; b: string; survivor: string }> | null;
  record_data_before: Record<string, unknown> | null;
  record_data_after: Record<string, unknown> | null;
  audit?: AuditEntry[];
}

export interface AuditEntry {
  id: string;
  action: string;
  actor_name: string;
  record_key: string;
  data_before: Record<string, unknown> | null;
  data_after: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface DedupCandidate {
  id: string;
  object_type: string;
  record_key_a: string;
  record_key_b: string;
  match_score: number;
  match_method: string;
  match_fields: Record<string, unknown> | null;
  status: string;
  survivor_key: string | null;
  merged_at: string | null;
  created_at: string;
}

export interface CleaningMetrics {
  metrics: Array<Record<string, unknown>>;
  totals: {
    detected: number;
    recommended: number;
    approved: number;
    rejected: number;
    applied: number;
    verified: number;
    rolled_back: number;
    auto_approved: number;
  };
}

// ── Cleaning Queue ───────────────────────────────────────────────────────────

export async function getCleaningQueue(params: {
  object_type?: string;
  status?: string;
  page?: number;
  per_page?: number;
}): Promise<{ items: CleaningQueueItem[]; total: number; page: number; per_page: number }> {
  const { data } = await apiClient.get("/api/v1/cleaning/queue", { params });
  return data;
}

export async function getCleaningItem(id: string): Promise<CleaningQueueItem> {
  const { data } = await apiClient.get(`/api/v1/cleaning/queue/${id}`);
  return data;
}

export async function approveCleaning(id: string, notes?: string): Promise<{ id: string; status: string }> {
  const { data } = await apiClient.post(`/api/v1/cleaning/approve/${id}`, { notes });
  return data;
}

export async function rejectCleaning(id: string, reason: string): Promise<{ id: string; status: string }> {
  const { data } = await apiClient.post(`/api/v1/cleaning/reject/${id}`, { reason });
  return data;
}

export async function bulkApprove(params: {
  rule_id?: string;
  severity?: string;
  max_count?: number;
}): Promise<{ approved_count: number; skipped_count: number }> {
  const { data } = await apiClient.post("/api/v1/cleaning/bulk-approve", params);
  return data;
}

export async function applyCleaning(id: string, override_data?: Record<string, unknown>): Promise<{ id: string; status: string; rollback_deadline: string }> {
  const { data } = await apiClient.post(`/api/v1/cleaning/apply/${id}`, { override_data });
  return data;
}

export async function rollbackCleaning(id: string): Promise<{ id: string; status: string }> {
  const { data } = await apiClient.post(`/api/v1/cleaning/rollback/${id}`);
  return data;
}

export async function getCleaningMetrics(period_type?: string): Promise<CleaningMetrics> {
  const { data } = await apiClient.get("/api/v1/cleaning/metrics", { params: { period_type } });
  return data;
}

export async function getCleaningAudit(params: {
  queue_id?: string;
  action?: string;
  page?: number;
  per_page?: number;
}): Promise<{ items: AuditEntry[]; total: number }> {
  const { data } = await apiClient.get("/api/v1/cleaning/audit", { params });
  return data;
}

// ── Dedup ────────────────────────────────────────────────────────────────────

export async function getDedupCandidates(params: {
  object_type: string;
  min_score?: number;
  status?: string;
}): Promise<{ items: DedupCandidate[]; total: number }> {
  const { data } = await apiClient.get(`/api/v1/dedup/candidates/${params.object_type}`, {
    params: { min_score: params.min_score, status: params.status },
  });
  return data;
}

export async function getDedupPreview(params: {
  record_key_a: string;
  record_key_b: string;
  object_type: string;
}): Promise<{ merge_preview: Record<string, { a: string; b: string; survivor: string }> }> {
  const { data } = await apiClient.post("/api/v1/dedup/preview", params);
  return data;
}

export async function mergeDedupCandidate(params: {
  candidate_id: string;
  survivor_key: string;
  field_overrides?: Record<string, unknown>;
}): Promise<{ id: string; status: string; survivor_key: string; merged_at: string }> {
  const { data } = await apiClient.post("/api/v1/dedup/merge", params);
  return data;
}

// ── Export ───────────────────────────────────────────────────────────────────

export type ExportFormat = "csv" | "lsmw" | "bapi" | "idoc" | "sf_csv";

export async function downloadCleaningExport(
  format: ExportFormat,
  objectType?: string,
): Promise<void> {
  const params = new URLSearchParams({ status: "applied" });
  if (objectType) params.set("object_type", objectType);

  const response = await apiClient.get(
    `/api/v1/cleaning/export/${format}?${params.toString()}`,
    { responseType: "blob" },
  );

  const disposition = response.headers["content-disposition"] ?? "";
  const filenameMatch = disposition.match(/filename=(.+)/);
  const filename = filenameMatch?.[1] ?? `cleaning_export_${format}.${format === "bapi" || format === "idoc" ? "json" : format === "lsmw" ? "txt" : "csv"}`;

  const url = window.URL.createObjectURL(new Blob([response.data]));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}
