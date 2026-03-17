import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, relationship


class Base(DeclarativeBase):
    pass


class Tenant(Base):
    __tablename__ = "tenants"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(Text, nullable=False)
    licensed_modules = Column(ARRAY(Text), nullable=False, server_default="{}")
    dqs_weights = Column(JSONB, nullable=True)
    alert_thresholds = Column(JSONB, nullable=True)
    stripe_customer_id = Column(Text, nullable=True)
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )

    default_role = Column(Text, nullable=True, server_default="analyst")

    versions = relationship("AnalysisVersion", back_populates="tenant")
    findings = relationship("Finding", back_populates="tenant")
    users = relationship("User", back_populates="tenant")
    notifications = relationship("Notification", back_populates="tenant")


class AnalysisVersion(Base):
    __tablename__ = "analysis_versions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(
        UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False
    )
    run_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )
    label = Column(Text, nullable=True)
    dqs_summary = Column(JSONB, nullable=True)
    metadata_ = Column("metadata", JSONB, nullable=True)
    status = Column(
        String(20), nullable=False, server_default="pending"
    )

    tenant = relationship("Tenant", back_populates="versions")
    findings = relationship("Finding", back_populates="version")


class Finding(Base):
    __tablename__ = "findings"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    version_id = Column(
        UUID(as_uuid=True),
        ForeignKey("analysis_versions.id"),
        nullable=False,
    )
    tenant_id = Column(
        UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False
    )
    module = Column(Text, nullable=False)
    check_id = Column(Text, nullable=False)
    severity = Column(Text, nullable=False)
    dimension = Column(Text, nullable=False)
    affected_count = Column(Integer, nullable=False, server_default="0")
    total_count = Column(Integer, nullable=False, server_default="0")
    pass_rate = Column(Numeric, nullable=True)
    details = Column(JSONB, nullable=True)
    remediation_text = Column(Text, nullable=True)
    rule_context = Column(JSONB, nullable=True)
    value_fix_map = Column(JSONB, nullable=True)
    record_fixes = Column(JSONB, nullable=True)
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )

    version = relationship("AnalysisVersion", back_populates="findings")
    tenant = relationship("Tenant", back_populates="findings")

    __table_args__ = (
        Index("ix_findings_tenant_version", "tenant_id", "version_id"),
        Index("ix_findings_tenant_module_severity", "tenant_id", "module", "severity"),
    )


class Report(Base):
    __tablename__ = "reports"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    version_id = Column(
        UUID(as_uuid=True),
        ForeignKey("analysis_versions.id"),
        nullable=False,
    )
    tenant_id = Column(
        UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False
    )
    report_json = Column(JSONB, nullable=True)
    pdf_path = Column(Text, nullable=True)
    generated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )

    __table_args__ = (
        Index("ix_reports_tenant_version", "tenant_id", "version_id"),
    )


class CleaningRule(Base):
    __tablename__ = "cleaning_rules"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    object_type = Column(Text, nullable=False)
    category = Column(Text, nullable=False)  # dedup|standardisation|enrichment|validation|lifecycle
    name = Column(Text, nullable=False)
    description = Column(Text, nullable=True)
    detection_logic = Column(Text, nullable=True)
    correction_logic = Column(Text, nullable=True)
    risk_level = Column(Text, nullable=False, server_default="medium")
    automation_level = Column(Text, nullable=False, server_default="single_approval")
    approval_required = Column(Boolean, nullable=False, server_default="true")
    is_active = Column(Boolean, nullable=False, server_default="true")
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))


class CleaningQueue(Base):
    __tablename__ = "cleaning_queue"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    rule_id = Column(UUID(as_uuid=True), ForeignKey("cleaning_rules.id"), nullable=True)
    object_type = Column(Text, nullable=False)
    status = Column(Text, nullable=False, server_default="detected")
    confidence = Column(Numeric, nullable=True)
    record_key = Column(Text, nullable=False)
    record_data_before = Column(JSONB, nullable=True)
    record_data_after = Column(JSONB, nullable=True)
    survivor_key = Column(Text, nullable=True)
    merge_preview = Column(JSONB, nullable=True)
    priority = Column(Integer, nullable=False, server_default="50")
    assigned_to = Column(UUID(as_uuid=True), nullable=True)
    detected_at = Column(DateTime(timezone=True), server_default=text("now()"))
    approved_by = Column(UUID(as_uuid=True), nullable=True)
    applied_at = Column(DateTime(timezone=True), nullable=True)
    rollback_deadline = Column(DateTime(timezone=True), nullable=True)
    batch_id = Column(UUID(as_uuid=True), nullable=True)
    version_id = Column(UUID(as_uuid=True), ForeignKey("analysis_versions.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    __table_args__ = (
        Index("ix_cleaning_queue_tenant_status", "tenant_id", "status"),
        Index("ix_cleaning_queue_tenant_object", "tenant_id", "object_type"),
    )


class CleaningAudit(Base):
    __tablename__ = "cleaning_audit"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    queue_id = Column(UUID(as_uuid=True), ForeignKey("cleaning_queue.id"), nullable=False)
    rule_id = Column(UUID(as_uuid=True), nullable=True)
    action = Column(Text, nullable=False)
    actor_id = Column(UUID(as_uuid=True), nullable=True)
    actor_name = Column(Text, nullable=True)
    record_key = Column(Text, nullable=False)
    object_type = Column(Text, nullable=False)
    data_before = Column(JSONB, nullable=True)
    data_after = Column(JSONB, nullable=True)
    metadata_ = Column("metadata", JSONB, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    __table_args__ = (
        Index("ix_cleaning_audit_tenant_queue", "tenant_id", "queue_id"),
    )


class DedupCandidate(Base):
    __tablename__ = "dedup_candidates"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    object_type = Column(Text, nullable=False)
    record_key_a = Column(Text, nullable=False)
    record_key_b = Column(Text, nullable=False)
    match_score = Column(Numeric, nullable=False)
    match_method = Column(Text, nullable=False)
    match_fields = Column(JSONB, nullable=True)
    status = Column(Text, nullable=False, server_default="pending")
    survivor_key = Column(Text, nullable=True)
    merged_at = Column(DateTime(timezone=True), nullable=True)
    merged_by = Column(UUID(as_uuid=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    __table_args__ = (
        Index("ix_dedup_candidates_tenant_object", "tenant_id", "object_type"),
    )


class CleaningMetric(Base):
    __tablename__ = "cleaning_metrics"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    period = Column(Text, nullable=False)
    period_type = Column(Text, nullable=False)
    object_type = Column(Text, nullable=False)
    detected = Column(Integer, nullable=False, server_default="0")
    recommended = Column(Integer, nullable=False, server_default="0")
    approved = Column(Integer, nullable=False, server_default="0")
    rejected = Column(Integer, nullable=False, server_default="0")
    applied = Column(Integer, nullable=False, server_default="0")
    verified = Column(Integer, nullable=False, server_default="0")
    rolled_back = Column(Integer, nullable=False, server_default="0")
    auto_approved = Column(Integer, nullable=False, server_default="0")
    avg_review_hours = Column(Numeric, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    __table_args__ = (
        UniqueConstraint("tenant_id", "period", "period_type", "object_type", name="uq_cleaning_metrics_tenant_period"),
    )


class StewardMetric(Base):
    __tablename__ = "steward_metrics"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    user_id = Column(UUID(as_uuid=True), nullable=True)
    period = Column(Text, nullable=False)
    items_processed = Column(Integer, nullable=False, server_default="0")
    items_approved = Column(Integer, nullable=False, server_default="0")
    items_rejected = Column(Integer, nullable=False, server_default="0")
    items_applied = Column(Integer, nullable=False, server_default="0")
    total_review_hours = Column(Numeric, nullable=False, server_default="0")
    exceptions_resolved = Column(Integer, nullable=False, server_default="0")
    dqs_impact = Column(Numeric, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))


# ── Phase B: Exception management ────────────────────────────────────────────


class Exception_(Base):
    __tablename__ = "exceptions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    type = Column(Text, nullable=False)
    category = Column(Text, nullable=False)
    severity = Column(Text, nullable=False)
    status = Column(Text, nullable=False, server_default="open")
    title = Column(Text, nullable=False)
    description = Column(Text, nullable=False)
    source_system = Column(Text, nullable=True)
    source_reference = Column(Text, nullable=True)
    affected_records = Column(JSONB, nullable=True)
    estimated_impact_zar = Column(Numeric, nullable=True)
    assigned_to = Column(UUID(as_uuid=True), nullable=True)
    escalation_tier = Column(Integer, nullable=False, server_default="1")
    sla_deadline = Column(DateTime(timezone=True), nullable=True)
    root_cause_category = Column(Text, nullable=True)
    resolution_type = Column(Text, nullable=True)
    resolution_notes = Column(Text, nullable=True)
    linked_finding_id = Column(UUID(as_uuid=True), ForeignKey("findings.id"), nullable=True)
    linked_cleaning_id = Column(UUID(as_uuid=True), ForeignKey("cleaning_queue.id"), nullable=True)
    billing_tier = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    closed_at = Column(DateTime(timezone=True), nullable=True)

    comments = relationship("ExceptionComment", back_populates="exception")

    __table_args__ = (
        Index("ix_exceptions_tenant_status", "tenant_id", "status"),
        Index("ix_exceptions_tenant_type", "tenant_id", "type"),
        Index("ix_exceptions_tenant_severity", "tenant_id", "severity"),
        Index("ix_exceptions_sla_deadline", "sla_deadline"),
    )


class ExceptionComment(Base):
    __tablename__ = "exception_comments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    exception_id = Column(UUID(as_uuid=True), ForeignKey("exceptions.id"), nullable=False)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    user_id = Column(UUID(as_uuid=True), nullable=True)
    user_name = Column(Text, nullable=False)
    body = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    exception = relationship("Exception_", back_populates="comments")

    __table_args__ = (
        Index("ix_exception_comments_exception", "exception_id"),
    )


class ExceptionRule(Base):
    __tablename__ = "exception_rules"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    name = Column(Text, nullable=False)
    description = Column(Text, nullable=False)
    rule_type = Column(Text, nullable=False)
    object_type = Column(Text, nullable=False)
    condition = Column(Text, nullable=False)
    severity = Column(Text, nullable=False)
    auto_assign_to = Column(UUID(as_uuid=True), nullable=True)
    is_active = Column(Boolean, nullable=False, server_default="false")
    created_by = Column(UUID(as_uuid=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    __table_args__ = (
        Index("ix_exception_rules_tenant", "tenant_id"),
    )


class ExceptionBilling(Base):
    __tablename__ = "exception_billing"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    period = Column(Text, nullable=False)
    tier1_count = Column(Integer, nullable=False, server_default="0")
    tier2_count = Column(Integer, nullable=False, server_default="0")
    tier3_count = Column(Integer, nullable=False, server_default="0")
    tier4_count = Column(Integer, nullable=False, server_default="0")
    tier1_amount = Column(Numeric, nullable=False, server_default="0")
    tier2_amount = Column(Numeric, nullable=False, server_default="0")
    tier3_amount = Column(Numeric, nullable=False, server_default="0")
    tier4_amount = Column(Numeric, nullable=False, server_default="0")
    base_fee = Column(Numeric, nullable=False, server_default="8000")
    total_amount = Column(Numeric, nullable=False, server_default="0")
    stripe_invoice_id = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    __table_args__ = (
        UniqueConstraint("tenant_id", "period", name="uq_exception_billing_tenant_period"),
    )


# ── Phase C: Analytics ───────────────────────────────────────────────────────


class DqsHistory(Base):
    __tablename__ = "dqs_history"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    module_id = Column(Text, nullable=False)
    dqs_score = Column(Numeric, nullable=False)
    completeness = Column(Numeric, nullable=True)
    accuracy = Column(Numeric, nullable=True)
    consistency = Column(Numeric, nullable=True)
    timeliness = Column(Numeric, nullable=True)
    uniqueness = Column(Numeric, nullable=True)
    validity = Column(Numeric, nullable=True)
    finding_count = Column(Integer, nullable=False, server_default="0")
    recorded_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    __table_args__ = (
        Index("ix_dqs_history_tenant_module_recorded", "tenant_id", "module_id", "recorded_at"),
    )


class ImpactRecord(Base):
    __tablename__ = "impact_records"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    version_id = Column(UUID(as_uuid=True), ForeignKey("analysis_versions.id"), nullable=False)
    category = Column(Text, nullable=False)
    description = Column(Text, nullable=True)
    annual_risk_zar = Column(Numeric, nullable=False, server_default="0")
    mitigated_zar = Column(Numeric, nullable=False, server_default="0")
    finding_count = Column(Integer, nullable=False, server_default="0")
    calculation_method = Column(Text, nullable=True)
    recorded_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    __table_args__ = (
        Index("ix_impact_records_tenant_version", "tenant_id", "version_id"),
    )


class CostAvoidance(Base):
    __tablename__ = "cost_avoidance"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    period = Column(Text, nullable=False)
    subscription_cost_zar = Column(Numeric, nullable=False, server_default="0")
    risk_mitigated_zar = Column(Numeric, nullable=False, server_default="0")
    exceptions_value_zar = Column(Numeric, nullable=False, server_default="0")
    cleaning_value_zar = Column(Numeric, nullable=False, server_default="0")
    cumulative_roi_multiple = Column(Numeric, nullable=False, server_default="0")
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    __table_args__ = (
        UniqueConstraint("tenant_id", "period", name="uq_cost_avoidance_tenant_period"),
    )


# ── Phase D: Contracts ──────────────────────────────────────────────────────


class Contract(Base):
    __tablename__ = "contracts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    name = Column(Text, nullable=False)
    description = Column(Text, nullable=True)
    producer = Column(Text, nullable=False)
    consumer = Column(Text, nullable=False)
    schema_contract = Column(JSONB, nullable=True)
    quality_contract = Column(JSONB, nullable=True)
    freshness_contract = Column(JSONB, nullable=True)
    volume_contract = Column(JSONB, nullable=True)
    status = Column(Text, nullable=False, server_default="draft")
    created_by = Column(UUID(as_uuid=True), nullable=True)
    approved_by = Column(UUID(as_uuid=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))
    activated_at = Column(DateTime(timezone=True), nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=True)

    compliance_history = relationship("ContractComplianceHistory", back_populates="contract")

    __table_args__ = (
        Index("ix_contracts_tenant_status", "tenant_id", "status"),
    )


class ContractComplianceHistory(Base):
    __tablename__ = "contract_compliance_history"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    contract_id = Column(UUID(as_uuid=True), ForeignKey("contracts.id"), nullable=False)
    version_id = Column(UUID(as_uuid=True), ForeignKey("analysis_versions.id"), nullable=True)
    completeness_actual = Column(Numeric, nullable=True)
    accuracy_actual = Column(Numeric, nullable=True)
    consistency_actual = Column(Numeric, nullable=True)
    timeliness_actual = Column(Numeric, nullable=True)
    uniqueness_actual = Column(Numeric, nullable=True)
    validity_actual = Column(Numeric, nullable=True)
    overall_compliant = Column(Boolean, nullable=False, server_default="false")
    violations = Column(JSONB, nullable=True)
    recorded_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    contract = relationship("Contract", back_populates="compliance_history")

    __table_args__ = (
        Index("ix_contract_compliance_tenant_contract_recorded", "tenant_id", "contract_id", "recorded_at"),
    )


# ── Phase F: RBAC & Notifications ─────────────────────────────────────────


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    clerk_user_id = Column(Text, nullable=True, unique=True)
    email = Column(Text, nullable=False)
    name = Column(Text, nullable=False)
    role = Column(Text, nullable=False, server_default="analyst")
    permissions = Column(JSONB, nullable=True)
    is_active = Column(Boolean, nullable=False, server_default="true")
    last_login = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )

    tenant = relationship("Tenant", back_populates="users")
    notifications = relationship("Notification", back_populates="user")


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    type = Column(Text, nullable=False)  # finding|cleaning|exception|approval|digest|warning
    title = Column(Text, nullable=False)
    body = Column(Text, nullable=False)
    link = Column(Text, nullable=True)
    is_read = Column(Boolean, nullable=False, server_default="false")
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )

    tenant = relationship("Tenant", back_populates="notifications")
    user = relationship("User", back_populates="notifications")

    __table_args__ = (
        Index("ix_notifications_tenant_user_read_created", "tenant_id", "user_id", "is_read", "created_at"),
    )

