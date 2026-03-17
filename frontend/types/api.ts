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

export interface RuleContext {
  why_it_matters: string;
  rule_authority:
    | "sap_hard_constraint"
    | "s4hana_migration"
    | "best_practice"
    | "customer_configured";
  sap_impact: string;
  valid_values_with_labels?: Record<string, string>;
}

export interface ValueFixEntry {
  invalid_value: string;
  fix_instruction: string;
  suggested_value: string | null;
  sql_statement: string | null;
}

export interface RecordFixEntry {
  record_id: string;
  id_field: string;
  invalid_value: string;
  fix_instruction: string;
  sql_statement: string | null;
}

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
    distinct_invalid_values?: Record<string, number>;
    id_field_used?: string;
    field_checked?: string;
    [key: string]: unknown;
  };
  remediation_text: string | null;
  rule_context: RuleContext | null;
  value_fix_map: Record<string, ValueFixEntry> | null;
  record_fixes: RecordFixEntry[] | null;
  created_at: string;
}

export interface FindingReportContext {
  finding_id: string;
  check_id: string;
  module: string;
  report_context: {
    cross_finding_patterns: Array<{
      pattern_description: string;
      affected_check_ids: string[];
      shared_record_count: number;
      recommended_approach: string;
    }>;
    effort_estimate: {
      check_id: string;
      affected_count: number;
      fix_complexity: string;
      estimated_person_hours: number;
      estimation_basis: string;
    } | null;
    fix_sequence: {
      sequence: number;
      check_id: string;
      reason: string;
    } | null;
    flags: Array<{ check_id: string; flag: string }>;
    executive_summary: string | null;
  } | null;
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
export interface LicenceStatus {
  valid: boolean | null;
  modules?: string[];
  expires_at?: string | null;
  days_remaining?: number | null;
  last_checked?: string | null;
  status?: string;
  reason?: string;
}

export interface HealthResponse {
  status: string;
  version: string;
  llm_provider: string;
  llm_connected: boolean;
  licence: LicenceStatus;
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

/* ─── Exceptions ─── */

export type ExceptionType =
  | "sap_transaction"
  | "dq_rule"
  | "custom_business"
  | "anomaly"
  | "contract_violation";

export type ExceptionStatus =
  | "open"
  | "investigating"
  | "pending_approval"
  | "resolved"
  | "verified"
  | "closed";

export interface Exception {
  id: string;
  tenant_id: string;
  type: ExceptionType;
  category: string;
  severity: Severity;
  status: ExceptionStatus;
  title: string;
  description: string;
  source_system: string | null;
  source_reference: string | null;
  affected_records: Record<string, unknown> | null;
  estimated_impact_zar: number | null;
  assigned_to: string | null;
  escalation_tier: number;
  sla_deadline: string | null;
  root_cause_category: string | null;
  resolution_type: string | null;
  resolution_notes: string | null;
  linked_finding_id: string | null;
  linked_cleaning_id: string | null;
  linked_finding?: Record<string, unknown> | null;
  linked_cleaning?: Record<string, unknown> | null;
  billing_tier: number | null;
  created_at: string;
  resolved_at: string | null;
  closed_at: string | null;
  comments?: ExceptionComment[];
}

export interface ExceptionComment {
  id: string;
  exception_id: string;
  user_id: string | null;
  user_name: string;
  text: string;
  created_at: string;
}

export interface ExceptionRule {
  id: string;
  tenant_id: string;
  name: string;
  description: string;
  rule_type: string;
  object_type: string;
  condition: string;
  severity: Severity;
  auto_assign_to: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
}

export interface ExceptionMetrics {
  open_count: number;
  resolved_count: number;
  avg_resolution_hours: number;
  sla_compliance_pct: number;
  overdue_count: number;
  by_type: Record<string, number>;
  by_severity: Record<string, number>;
}

export interface ExceptionBilling {
  period: string;
  tier1_count: number;
  tier2_count: number;
  tier3_count: number;
  tier4_count: number;
  tier1_amount: number;
  tier2_amount: number;
  tier3_amount: number;
  tier4_amount: number;
  base_fee: number;
  total_amount: number;
}

export interface ExceptionListResponse {
  exceptions: Exception[];
  total: number;
  page: number;
  per_page: number;
}
