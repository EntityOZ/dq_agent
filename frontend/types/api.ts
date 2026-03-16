/* ─── Dimension scores ─── */
export interface DimensionScores {
  completeness: number;
  accuracy: number;
  consistency: number;
  timeliness: number;
  uniqueness: number;
  validity: number;
}

/* ─── Per-module DQS summary ─── */
export interface DQSSummary {
  composite_score: number;
  dimension_scores: DimensionScores;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  total_checks: number;
  passing_checks: number;
  capped: boolean;
  cap_reason: string | null;
}

/* ─── Analysis version ─── */
export interface Version {
  id: string;
  run_at: string;
  label: string | null;
  status:
    | "pending"
    | "running"
    | "complete"
    | "failed"
    | "agents_enqueued"
    | "agents_running"
    | "agents_complete"
    | "agents_failed";
  dqs_summary: Record<string, DQSSummary> | null;
  metadata: {
    modules: string[];
    file_name: string;
    row_count: number;
    columns?: string[];
    parquet_path?: string;
  } | null;
}

export interface VersionList {
  versions: Version[];
}

/* ─── Version comparison ─── */
export interface ModuleDelta {
  dqs_change: number;
  v1_score: number;
  v2_score: number;
}

export interface VersionComparison {
  v1: Version;
  v2: Version;
  delta: Record<string, ModuleDelta>;
}

/* ─── Finding ─── */
export type Severity = "critical" | "high" | "medium" | "low" | "warning";
export type Dimension =
  | "completeness"
  | "accuracy"
  | "consistency"
  | "timeliness"
  | "uniqueness"
  | "validity";

export interface Finding {
  id: string;
  module: string;
  check_id: string;
  severity: Severity;
  dimension: Dimension;
  affected_count: number;
  total_count: number;
  pass_rate: number | null;
  details: {
    message?: string;
    sample_failing_records?: Record<string, unknown>[];
    [key: string]: unknown;
  };
  remediation_text: string | null;
  created_at: string;
}

export interface FindingList {
  findings: Finding[];
  total: number;
  filters_applied: Record<string, string>;
}

/* ─── Upload ─── */
export interface UploadResponse {
  version_id: string;
  job_id: string;
  status: string;
}

/* ─── Health ─── */
export interface HealthResponse {
  status: string;
  version: string;
  llm_provider: string;
  timestamp: string;
}

/* ─── Report ─── */
export interface ReportModule {
  name: string;
  dqs_score: number;
  readiness_status: "go" | "conditional" | "no-go";
  critical_count: number;
  root_causes?: unknown[];
  remediations?: unknown[];
  blockers?: string[];
  conditions?: string[];
}

export interface ReportJson {
  executive_summary: string;
  overall_dqs: { composite: number; by_module?: Record<string, number> };
  findings_by_severity: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    total: number;
  };
  migration_readiness: {
    overall_status: "go" | "conditional" | "no-go";
    overall_score: number;
    summary: string;
  };
  modules: ReportModule[];
}

/* ─── Settings ─── */
export interface TenantSettings {
  name: string;
  licensed_modules: string[];
  dqs_weights: DimensionScores | null;
  alert_thresholds: {
    critical_threshold: number;
    high_threshold: number;
    dqs_drop_threshold: number;
  } | null;
  notification_config: {
    email: string;
    teams_webhook: string;
    daily_digest: boolean;
    weekly_summary: boolean;
    monthly_report: boolean;
  } | null;
  stripe_customer_id: string | null;
}
