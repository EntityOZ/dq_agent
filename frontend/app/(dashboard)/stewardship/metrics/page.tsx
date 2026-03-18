"use client";

import Link from "next/link";
import {
  ArrowLeft,
  BarChart3,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Brain,
  Users,
  Loader2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { getMetrics } from "@/lib/api/stewardship";
import type { StewardshipMetrics } from "@/types/api";

// ── Stat Card ───────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon,
  color = "text-[#0695A8]",
  bg = "bg-[#0695A8]/10",
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  color?: string;
  bg?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div
          className={`flex h-10 w-10 items-center justify-center rounded-lg ${bg}`}
        >
          <span className={color}>{icon}</span>
        </div>
        <div>
          <p className="text-2xl font-bold text-[#0F2137]">{value}</p>
          <p className="text-xs text-[#6B92AD]">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Bar Component ───────────────────────────────────────────────────────────

function HorizontalBar({
  label,
  value,
  max,
  color = "bg-[#0695A8]",
}: {
  label: string;
  value: number;
  max: number;
  color?: string;
}) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="w-36 shrink-0 truncate text-sm text-[#0F2137]">
        {label}
      </span>
      <div className="flex-1 h-3 rounded-full bg-[#F0F5FA]">
        <div
          className={`h-3 rounded-full ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-10 text-right text-sm font-medium text-[#0F2137]">
        {value}
      </span>
    </div>
  );
}

// ── Type Label Formatter ────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  merge_decision: "Merge Decision",
  golden_record_review: "Golden Record",
  exception: "Exception",
  writeback_approval: "Writeback",
  contract_breach: "Contract Breach",
  glossary_review: "Glossary Review",
};

function formatType(t: string): string {
  return TYPE_LABELS[t] ?? t.replace(/_/g, " ");
}

// ── Main Page ───────────────────────────────────────────────────────────────

export default function StewardshipMetricsPage() {
  // Simulated user role
  const userRole =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("role") ?? "admin"
      : "admin";

  const { data: metrics, isLoading } = useQuery<StewardshipMetrics>({
    queryKey: ["stewardship-metrics"],
    queryFn: getMetrics,
    refetchInterval: 30_000,
  });

  const isAiReviewer = userRole === "ai_reviewer";

  if (isLoading || !metrics) {
    return (
      <div className="flex h-60 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-[#0695A8]" />
      </div>
    );
  }

  const typeMax = Math.max(...Object.values(metrics.items_by_type), 1);
  const statusMax = Math.max(...Object.values(metrics.items_by_status), 1);
  const resMax =
    Object.values(metrics.avg_resolution_hours_by_type).length > 0
      ? Math.max(...Object.values(metrics.avg_resolution_hours_by_type), 1)
      : 1;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/stewardship">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back
          </Button>
        </Link>
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0695A8]/10">
          <BarChart3 className="h-5 w-5 text-[#0695A8]" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-[#0F2137]">
            Stewardship Metrics
          </h1>
          <p className="text-sm text-[#6B92AD]">
            Productivity and queue health dashboard
          </p>
        </div>
      </div>

      {/* Top stats */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard
          label="Backlog"
          value={metrics.backlog_total}
          icon={<AlertTriangle className="h-5 w-5" />}
          color="text-[#D97706]"
          bg="bg-[#D97706]/10"
        />
        <StatCard
          label="SLA Compliance"
          value={`${Math.round(metrics.sla_compliance_rate * 100)}%`}
          icon={<Clock className="h-5 w-5" />}
          color={
            metrics.sla_compliance_rate >= 0.9
              ? "text-[#059669]"
              : "text-[#DC2626]"
          }
          bg={
            metrics.sla_compliance_rate >= 0.9
              ? "bg-[#059669]/10"
              : "bg-[#DC2626]/10"
          }
        />
        <StatCard
          label="Resolved"
          value={metrics.items_by_status["resolved"] ?? 0}
          icon={<CheckCircle2 className="h-5 w-5" />}
          color="text-[#059669]"
          bg="bg-[#059669]/10"
        />
        {metrics.ai_acceptance_rate !== null &&
          metrics.ai_acceptance_rate !== undefined && (
            <StatCard
              label="AI Acceptance Rate"
              value={`${Math.round(metrics.ai_acceptance_rate * 100)}%`}
              icon={<Brain className="h-5 w-5" />}
              color="text-[#7C3AED]"
              bg="bg-[#7C3AED]/10"
            />
          )}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Items by type */}
        <Card>
          <CardContent className="p-4">
            <h3 className="mb-3 text-sm font-semibold text-[#0F2137]">
              Items by Type
            </h3>
            <div className="space-y-2">
              {Object.entries(metrics.items_by_type).map(([type, count]) => (
                <HorizontalBar
                  key={type}
                  label={formatType(type)}
                  value={count}
                  max={typeMax}
                />
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Items by status */}
        <Card>
          <CardContent className="p-4">
            <h3 className="mb-3 text-sm font-semibold text-[#0F2137]">
              Items by Status
            </h3>
            <div className="space-y-2">
              {Object.entries(metrics.items_by_status).map(
                ([status, count]) => (
                  <HorizontalBar
                    key={status}
                    label={status.replace("_", " ")}
                    value={count}
                    max={statusMax}
                    color={
                      status === "resolved"
                        ? "bg-[#059669]"
                        : status === "escalated"
                          ? "bg-[#DC2626]"
                          : "bg-[#0695A8]"
                    }
                  />
                )
              )}
            </div>
          </CardContent>
        </Card>

        {/* Avg resolution time */}
        <Card>
          <CardContent className="p-4">
            <h3 className="mb-3 text-sm font-semibold text-[#0F2137]">
              Avg Resolution Time (hours)
            </h3>
            <div className="space-y-2">
              {Object.entries(metrics.avg_resolution_hours_by_type).map(
                ([type, hours]) => (
                  <HorizontalBar
                    key={type}
                    label={formatType(type)}
                    value={hours}
                    max={resMax}
                    color="bg-[#D97706]"
                  />
                )
              )}
              {Object.keys(metrics.avg_resolution_hours_by_type).length ===
                0 && (
                <p className="text-sm text-[#6B92AD]">
                  No resolved items yet
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Steward breakdown — NOT visible to ai_reviewer */}
        {!isAiReviewer && metrics.steward_breakdown && (
          <Card>
            <CardContent className="p-4">
              <div className="mb-3 flex items-center gap-2">
                <Users className="h-4 w-4 text-[#0695A8]" />
                <h3 className="text-sm font-semibold text-[#0F2137]">
                  Steward Performance (30 days)
                </h3>
              </div>
              <div className="space-y-3">
                {metrics.steward_breakdown.map((s) => (
                  <div
                    key={s.steward_name}
                    className="flex items-center justify-between rounded-lg border border-[#D6E4F0] px-3 py-2"
                  >
                    <div>
                      <p className="text-sm font-medium text-[#0F2137]">
                        {s.steward_name}
                      </p>
                      <p className="text-[10px] text-[#6B92AD]">
                        {s.resolved} resolved / {s.total} total
                      </p>
                    </div>
                    {s.avg_resolution_hours !== null && (
                      <div className="text-right">
                        <p className="text-sm font-medium text-[#0F2137]">
                          {s.avg_resolution_hours}h
                        </p>
                        <p className="text-[10px] text-[#6B92AD]">avg time</p>
                      </div>
                    )}
                  </div>
                ))}
                {metrics.steward_breakdown.length === 0 && (
                  <p className="text-sm text-[#6B92AD]">No steward data yet</p>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ai_reviewer notice */}
        {isAiReviewer && (
          <Card>
            <CardContent className="flex h-full items-center justify-center p-4">
              <p className="text-sm text-[#6B92AD]">
                Individual steward metrics are not visible to the AI Reviewer
                role.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
