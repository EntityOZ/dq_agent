import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
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

    versions = relationship("AnalysisVersion", back_populates="tenant")
    findings = relationship("Finding", back_populates="tenant")


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
