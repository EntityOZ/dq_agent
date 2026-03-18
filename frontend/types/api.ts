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
  /* Glossary enrichment (Phase K) */
  business_name?: string | null;
  glossary_term_id?: string | null;
  business_definition?: string | null;
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
  stripe_invoice_id: string | null;
}

export interface ExceptionListResponse {
  exceptions: Exception[];
  total: number;
  page: number;
  per_page: number;
}

/* ─── NLP ─── */

export interface NlpSource {
  type: string;
  id: string;
  relevance: string;
}

export interface NlpResponse {
  answer: string;
  sources: NlpSource[];
  data?: Record<string, unknown>[] | null;
  chart_type?: "bar" | "line" | "pie" | null;
}

/* ─── Lineage ─── */

export interface LineageNode {
  id: string;
  label: string;
  type: "record" | "finding" | "exception" | "cleaning" | "dedup";
  data: Record<string, unknown>;
}

export interface LineageEdge {
  source: string;
  target: string;
  label: string;
}

export interface LineageGraph {
  nodes: LineageNode[];
  edges: LineageEdge[];
}

/* ─── Contracts ─── */

export type ContractStatus = "draft" | "pending_approval" | "active" | "expired";

export interface Contract {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  producer: string;
  consumer: string;
  schema_contract: Record<string, unknown> | null;
  quality_contract: Record<string, number> | null;
  freshness_contract: Record<string, unknown> | null;
  volume_contract: Record<string, unknown> | null;
  status: ContractStatus;
  created_by: string | null;
  approved_by: string | null;
  created_at: string;
  activated_at: string | null;
  expires_at: string | null;
  latest_compliant?: boolean | null;
  last_checked?: string | null;
}

export interface ContractListResponse {
  contracts: Contract[];
  total: number;
}

export interface ComplianceRecord {
  id: string;
  contract_id: string;
  version_id: string | null;
  completeness_actual: number | null;
  accuracy_actual: number | null;
  consistency_actual: number | null;
  timeliness_actual: number | null;
  uniqueness_actual: number | null;
  validity_actual: number | null;
  overall_compliant: boolean;
  violations: Array<{
    dimension: string;
    threshold: number;
    actual: number;
    gap: number;
  }> | null;
  recorded_at: string;
}

export interface ComplianceHistoryResponse {
  contract_id: string;
  compliance_history: ComplianceRecord[];
}

/* ─── Notifications ─── */

export type NotificationType =
  | "finding"
  | "cleaning"
  | "exception"
  | "approval"
  | "digest"
  | "warning";

export interface Notification {
  id: string;
  tenant_id: string;
  user_id: string | null;
  type: NotificationType;
  title: string;
  body: string;
  link: string | null;
  is_read: boolean;
  created_at: string;
}

export interface NotificationListResponse {
  items: Notification[];
  total: number;
}

export interface UnreadCountResponse {
  count: number;
}

/* ─── Users / RBAC ─── */

export type UserRole =
  | "admin"
  | "steward"
  | "analyst"
  | "approver"
  | "auditor"
  | "viewer"
  | "ai_reviewer";

export interface User {
  id: string;
  tenant_id: string;
  clerk_user_id: string | null;
  email: string;
  name: string;
  role: UserRole;
  permissions: Record<string, unknown> | null;
  is_active: boolean;
  last_login: string | null;
  created_at: string;
}

export interface UserListResponse {
  users: User[];
}

/* ─── SAP Systems / Sync ─── */

export interface SAPSystem {
  id: string;
  name: string;
  host: string;
  client: string;
  sysnr: string;
  description: string | null;
  environment: "PRD" | "QAS" | "DEV";
  is_active: boolean;
  created_at: string;
  updated_at: string;
  last_sync_at: string | null;
  last_sync_status: string | null;
}

export interface SAPSystemListResponse {
  systems: SAPSystem[];
}

export interface TestConnectionResponse {
  connected: boolean;
  message: string;
}

export interface SyncProfile {
  id: string;
  system_id: string;
  domain: string;
  tables: string[];
  schedule_cron: string | null;
  active: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
}

/* ─── Golden Records / MDM ─── */

export type MasterRecordStatus =
  | "candidate"
  | "pending_review"
  | "golden"
  | "superseded";

export interface SourceContribution {
  value: unknown;
  source_system: string;
  extracted_at: string;
  confidence: number;
  ai_recommendation?: string;
  ai_confidence?: number;
  ai_reasoning?: string;
}

export interface MasterRecordSummary {
  id: string;
  domain: string;
  sap_object_key: string;
  overall_confidence: number;
  status: MasterRecordStatus;
  source_count: number;
  pending_issues: number;
  promoted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MasterRecordDetail {
  id: string;
  domain: string;
  sap_object_key: string;
  golden_fields: Record<string, unknown>;
  source_contributions: Record<string, SourceContribution>;
  overall_confidence: number;
  status: MasterRecordStatus;
  promoted_at: string | null;
  promoted_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface MasterRecordListResponse {
  records: MasterRecordSummary[];
  total: number;
  page: number;
  per_page: number;
}

export interface MasterRecordHistoryEntry {
  id: string;
  changed_at: string;
  changed_by: string | null;
  change_type: string;
  previous_fields: Record<string, unknown> | null;
  new_fields: Record<string, unknown> | null;
  ai_was_involved: boolean;
  ai_recommendation_accepted: boolean | null;
}

export interface SyncRun {
  id: string;
  profile_id: string;
  started_at: string;
  completed_at: string | null;
  rows_extracted: number;
  findings_delta: number;
  golden_records_updated: number;
  status: "running" | "completed" | "failed";
  error_detail: string | null;
  ai_quality_score: number | null;
  anomaly_flags: Array<{
    type: string;
    detail: string;
    severity?: string;
    column?: string;
  }> | null;
}

/* ─── Match & Merge Engine ─── */

export type MatchType = "exact" | "fuzzy" | "phonetic" | "numeric_range" | "semantic";

export interface MatchRule {
  id: string;
  tenant_id: string;
  domain: string;
  field: string;
  match_type: MatchType;
  weight: number;
  threshold: number;
  active: boolean;
}

export interface MatchRulesListResponse {
  rules: MatchRule[];
  total: number;
}

export interface AIProposedRule {
  id: string;
  tenant_id: string;
  domain: string;
  proposed_rule: {
    field: string;
    match_type: MatchType;
    weight: number;
    threshold: number;
  };
  rationale: string;
  supporting_correction_count: number;
  status: "pending" | "approved" | "rejected";
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface AIProposedRulesListResponse {
  rules: AIProposedRule[];
  total: number;
}

export interface SimulationResult {
  total_pairs: number;
  auto_merge_count: number;
  auto_dismiss_count: number;
  queue_count: number;
}

/* ─── Phase K: Business Glossary ─── */

export type GlossaryStatus = "active" | "under_review" | "deprecated";

export interface GlossaryTermSummary {
  id: string;
  sap_table: string;
  sap_field: string;
  technical_name: string;
  business_name: string;
  domain: string;
  mandatory_for_s4hana: boolean;
  status: GlossaryStatus;
  ai_drafted: boolean;
  last_reviewed_at: string | null;
  review_cycle_days: number;
  linked_rules_count: number;
}

export interface LinkedRule {
  rule_id: string;
  domain: string;
  pass_rate: number | null;
  severity: string | null;
  affected_count: number | null;
  total_count: number | null;
}

export interface GlossaryChangeEntry {
  id: string;
  changed_by: string;
  changed_at: string;
  field_changed: string;
  old_value: string | null;
  new_value: string | null;
  change_reason: string | null;
}

export interface GlossaryTermDetail {
  id: string;
  sap_table: string;
  sap_field: string;
  technical_name: string;
  business_name: string;
  business_definition: string | null;
  why_it_matters: string | null;
  sap_impact: string | null;
  domain: string;
  approved_values: Record<string, string> | string[] | null;
  mandatory_for_s4hana: boolean;
  rule_authority: string | null;
  data_steward_id: string | null;
  review_cycle_days: number;
  last_reviewed_at: string | null;
  status: GlossaryStatus;
  ai_drafted: boolean;
  created_at: string;
  updated_at: string;
  linked_rules: LinkedRule[];
  change_history: GlossaryChangeEntry[];
}

export interface GlossaryListResponse {
  terms: GlossaryTermSummary[];
  total: number;
  page: number;
  per_page: number;
}

export interface AIDraftResponse {
  business_definition: string;
  why_it_matters_business: string;
  committed: boolean;
}

export interface BatchLookupEntry {
  business_name: string;
  id: string;
  business_definition: string | null;
}

export interface BatchLookupResponse {
  lookup: Record<string, BatchLookupEntry>;
}
