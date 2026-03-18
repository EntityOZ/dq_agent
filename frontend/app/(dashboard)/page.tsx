"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Upload as UploadIcon,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Activity,
  Server,
  ShieldCheck,
  ClipboardList,
  Sparkles,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { getVersions } from "@/lib/api/versions";
import { getFindings } from "@/lib/api/findings";
import { getMdmDashboard } from "@/lib/api/mdm-metrics";
import { scoreColor, formatModuleName, relativeTime } from "@/lib/format";
import { useCountUp } from "@/hooks/use-count-up";
import { DqsSparkline } from "@/components/charts/dqs-sparkline";
import { DqsBarChart } from "@/components/charts/dqs-bar-chart";
import { DimensionDonut } from "@/components/charts/dimension-donut";
import { SeverityBarChart } from "@/components/charts/severity-bar-chart";
import type { Version, DQSSummary, DimensionScores, MdmMetric } from "@/types/api";

/* ─── Helpers ─── */

function averageDqs(summary: Record<string, DQSSummary>): number {
  const scores = Object.values(summary).map((m) => m.composite_score);
  if (scores.length === 0) return 0;
  return Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10;
}

function averageDimensions(summary: Record<string, DQSSummary>): DimensionScores {
  const modules = Object.values(summary);
  if (modules.length === 0) {
    return { completeness: 0, accuracy: 0, consistency: 0, timeliness: 0, uniqueness: 0, validity: 0 };
  }
  const dims: DimensionScores = { completeness: 0, accuracy: 0, consistency: 0, timeliness: 0, uniqueness: 0, validity: 0 };
  for (const m of modules) {
    for (const key of Object.keys(dims) as (keyof DimensionScores)[]) {
      dims[key] += m.dimension_scores[key] ?? 0;
    }
  }
  for (const key of Object.keys(dims) as (keyof DimensionScores)[]) {
    dims[key] = Math.round((dims[key] / modules.length) * 10) / 10;
  }
  return dims;
}

function aggregateSeverityCounts(summary: Record<string, DQSSummary>) {
  let critical = 0, high = 0, medium = 0, low = 0;
  for (const m of Object.values(summary)) {
    critical += m.critical_count ?? 0;
    high += m.high_count ?? 0;
    medium += m.medium_count ?? 0;
    low += m.low_count ?? 0;
  }
  return { critical, high, medium, low };
}

function getUserRole(): string {
  if (typeof window === "undefined") return "analyst";
  return new URLSearchParams(window.location.search).get("role") ?? "analyst";
}

/* ─── Main Dashboard ─── */

export default function DashboardPage() {
  const userRole = getUserRole();

  const {
    data: versionData,
    isLoading: versionsLoading,
    error: versionsError,
    refetch: refetchVersions,
  } = useQuery({
    queryKey: ["versions", { limit: 20 }],
    queryFn: () => getVersions({ limit: 20 }),
  });

  const {
    data: mdmData,
    isLoading: mdmLoading,
  } = useQuery({
    queryKey: ["mdm-dashboard"],
    queryFn: getMdmDashboard,
  });

  const versions = versionData?.versions ?? [];
  const completed = versions.filter((v) => v.status === "agents_complete" && v.dqs_summary);
  const latestComplete = completed[0];

  // Build merged DQS: latest run per module across ALL completed versions
  const mergedDqs: Record<string, DQSSummary> = {};
  const moduleVersionMap: Record<string, string> = {};
  for (const v of completed) {
    if (!v.dqs_summary) continue;
    for (const [mod, summary] of Object.entries(v.dqs_summary)) {
      if (!mergedDqs[mod]) {
        mergedDqs[mod] = summary;
        moduleVersionMap[mod] = v.id;
      }
    }
  }

  if (versionsLoading || mdmLoading) {
    return (
      <div className="grid grid-cols-12 gap-5">
        <Skeleton className="col-span-4 h-36 rounded-xl" />
        <Skeleton className="col-span-4 h-36 rounded-xl" />
        <Skeleton className="col-span-4 h-36 rounded-xl" />
        <Skeleton className="col-span-6 h-64 rounded-xl" />
        <Skeleton className="col-span-6 h-64 rounded-xl" />
        <Skeleton className="col-span-4 h-56 rounded-xl" />
        <Skeleton className="col-span-4 h-56 rounded-xl" />
        <Skeleton className="col-span-4 h-56 rounded-xl" />
      </div>
    );
  }

  if (versionsError) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          Failed to load dashboard data.{" "}
          <Button variant="link" className="px-0" onClick={() => refetchVersions()}>
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (!latestComplete || Object.keys(mergedDqs).length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-6 py-24">
        <UploadIcon className="h-16 w-16 text-[#6B92AD]" />
        <h2 className="font-display text-xl font-semibold text-[#0F2137]">No analysis data yet</h2>
        <p className="text-[#6B92AD]">Upload SAP data to get your first Data Quality Score.</p>
        <Link href="/upload">
          <Button className="bg-[#0695A8] text-white hover:bg-[#047A8A]">Upload Data</Button>
        </Link>
      </div>
    );
  }

  const dqs = mergedDqs;
  const overallScore = averageDqs(dqs);
  const dimensions = averageDimensions(dqs);
  const severityCounts = aggregateSeverityCounts(dqs);

  // DQS Trend data
  const sparklineData = completed
    .slice(0, 10)
    .reverse()
    .map((v) => ({ score: averageDqs(v.dqs_summary!) }));

  const prevComplete = completed[1];
  const prevScore = prevComplete?.dqs_summary ? averageDqs(prevComplete.dqs_summary) : null;
  const dqsDelta = prevScore !== null ? Math.round((overallScore - prevScore) * 10) / 10 : null;

  // MDM data
  const mdmLatest = mdmData?.latest ?? null;
  const mdmTrend = mdmData?.trend ?? [];
  const activeSystems = mdmData?.active_systems_count ?? 0;
  const mdmSparkline = mdmTrend.map((m) => ({ score: m.mdm_health_score }));

  // Bar chart data
  const barData = completed
    .slice(0, 10)
    .reverse()
    .map((v) => ({
      date: new Date(v.run_at).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      label: v.label ?? "",
      score: averageDqs(v.dqs_summary!),
    }));

  // Top modules sorted by score descending
  const moduleEntries = Object.entries(dqs)
    .map(([name, summary]) => ({ name, score: summary.composite_score }))
    .sort((a, b) => b.score - a.score);

  // Active runs
  const activeRuns = versions.filter(
    (v) => v.status === "running" || v.status === "agents_running" || v.status === "pending" || v.status === "agents_enqueued"
  ).length;

  // Role visibility
  const isViewer = userRole === "viewer";
  const canSeeMdm = !isViewer; // Everyone except viewer sees MDM Health Score
  const canSeeAiPanel = ["admin", "steward", "ai_reviewer"].includes(userRole);

  return (
    <div className="grid grid-cols-12 gap-5">
      {/* ═══════════════════════════════════════════════════════════════════════
          TOP ROW: MDM Health Score | DQS Score | Active Systems
          ═══════════════════════════════════════════════════════════════════════ */}

      {/* MDM Health Score — large card */}
      {canSeeMdm && mdmLatest && (
        <div
          className="vx-card col-span-5 flex flex-col gap-3 border-t-[3px] border-t-[#0695A8]"
          style={{ animationDelay: "0ms" }}
        >
          <MdmScoreDisplay
            score={mdmLatest.mdm_health_score}
            sparklineData={mdmSparkline}
          />
          <div className="grid grid-cols-2 gap-3 text-xs">
            <MetricPill
              label="Golden Coverage"
              value={`${(mdmLatest.golden_record_coverage_pct * 100).toFixed(0)}%`}
              color={mdmLatest.golden_record_coverage_pct >= 0.6 ? "#059669" : "#D97706"}
            />
            <MetricPill
              label="Match Confidence"
              value={`${(mdmLatest.avg_match_confidence * 100).toFixed(0)}%`}
              color={mdmLatest.avg_match_confidence >= 0.7 ? "#059669" : "#D97706"}
            />
            <MetricPill
              label="SLA Compliance"
              value={`${(mdmLatest.steward_sla_compliance_pct * 100).toFixed(0)}%`}
              color={mdmLatest.steward_sla_compliance_pct >= 0.8 ? "#059669" : "#DC2626"}
            />
            <MetricPill
              label="Source Consistency"
              value={`${(mdmLatest.source_consistency_pct * 100).toFixed(0)}%`}
              color={mdmLatest.source_consistency_pct >= 0.75 ? "#059669" : "#D97706"}
            />
          </div>
        </div>
      )}

      {/* DQS Score — smaller card (or full width if MDM not available) */}
      <div
        className={`vx-card flex flex-col gap-3 ${canSeeMdm && mdmLatest ? "col-span-4" : "col-span-5"}`}
        style={{ animationDelay: "40ms" }}
      >
        <ScoreDisplay score={overallScore} delta={dqsDelta} />
        <DqsSparkline data={sparklineData} height={40} />
        <div className="mt-auto text-xs text-[#6B92AD]">
          Last analysed: {relativeTime(latestComplete.run_at)}
          {latestComplete.label && (
            <span className="ml-1 text-[#3D6080]">— {latestComplete.label}</span>
          )}
        </div>
      </div>

      {/* Active Systems status */}
      <div
        className={`vx-card flex flex-col gap-4 ${canSeeMdm && mdmLatest ? "col-span-3" : "col-span-3"}`}
        style={{ animationDelay: "80ms" }}
      >
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6B92AD]">
          Active Systems
        </h3>
        <div className="flex items-baseline gap-2">
          <Server className="h-5 w-5 text-[#0695A8]" />
          <span className="font-display text-3xl font-bold text-[#0695A8]">{activeSystems}</span>
          <span className="text-xs text-[#6B92AD]">connected</span>
        </div>

        {/* Active Runs */}
        <div className="rounded-lg border border-[#D6E4F0] bg-[#F0F5FA] p-3">
          <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6B92AD]">
            Active Runs
          </h3>
          <div className="flex items-baseline gap-2">
            <span className="font-display text-2xl font-bold text-[#0695A8]">{activeRuns}</span>
            <span className="text-xs text-[#6B92AD]">
              {activeRuns === 1 ? "analysis in progress" : activeRuns === 0 ? "all complete" : "analyses in progress"}
            </span>
          </div>
        </div>

        {/* Stewardship backlog */}
        {canSeeMdm && mdmLatest && (
          <Link
            href="/stewardship"
            className="flex items-center gap-2 rounded-lg border border-[#D6E4F0] bg-white p-3 transition-all hover:-translate-y-0.5 hover:border-[#0695A8]"
          >
            <ClipboardList className="h-4 w-4 text-[#D97706]" />
            <div>
              <span className="font-display text-lg font-bold text-[#0F2137]">{mdmLatest.backlog_count}</span>
              <span className="ml-1 text-xs text-[#6B92AD]">queue items</span>
            </div>
          </Link>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          MIDDLE ROW: Golden Record Coverage by Domain | Sync Health Timeline
          ═══════════════════════════════════════════════════════════════════════ */}

      {/* Golden Record Coverage + DQS Over Time combined */}
      <div
        className="vx-card col-span-7 flex flex-col"
        style={{ animationDelay: "120ms" }}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6B92AD]">
            DQS Over Time
          </h3>
        </div>
        <div className="flex-1" style={{ minHeight: 220 }}>
          {barData.length >= 2 ? (
            <DqsBarChart data={barData} />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-[#6B92AD]">
              Upload data at least twice to see trends
            </div>
          )}
        </div>
      </div>

      {/* Top Modules + Module Health */}
      <div
        className="vx-card col-span-5 flex flex-col"
        style={{ animationDelay: "160ms" }}
      >
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6B92AD]">
          Top Modules
        </h3>
        <div className="space-y-2">
          {moduleEntries.slice(0, 5).map((m, i) => (
            <Link
              key={m.name}
              href={`/findings?module=${m.name}&version_id=${moduleVersionMap[m.name] ?? latestComplete.id}`}
              className="flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-[#F5F9FF]"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#0695A8] font-display text-xs font-bold text-white">
                {i + 1}
              </span>
              <span className="flex-1 text-sm text-[#0F2137]">{formatModuleName(m.name)}</span>
              <span className="font-display text-sm font-bold" style={{ color: scoreColor(m.score) }}>
                {m.score.toFixed(1)}
              </span>
            </Link>
          ))}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          BOTTOM ROW: Health by Dimension | Findings by Severity | Source Trust
          ═══════════════════════════════════════════════════════════════════════ */}

      {/* Health by Dimension */}
      <div
        className="vx-card col-span-4 flex flex-col items-center"
        style={{ animationDelay: "200ms" }}
      >
        <h3 className="mb-3 self-start text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6B92AD]">
          Health by Dimension
        </h3>
        <DimensionDonut dimensions={dimensions} overallScore={overallScore} />
      </div>

      {/* Findings by Severity */}
      <div
        className="vx-card col-span-4"
        style={{ animationDelay: "240ms" }}
      >
        <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6B92AD]">
          Findings by Severity
        </h3>
        <div style={{ height: 180 }}>
          <SeverityBarChart counts={severityCounts} />
        </div>
      </div>

      {/* Module Health Grid */}
      <div
        className="vx-card col-span-4"
        style={{ animationDelay: "280ms" }}
      >
        <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6B92AD]">
          Module Health
        </h3>
        <div className="grid grid-cols-2 gap-2">
          {moduleEntries.map((m) => (
            <Link
              key={m.name}
              href={`/findings?module=${m.name}&version_id=${moduleVersionMap[m.name] ?? latestComplete.id}`}
              className="group rounded-lg border border-[#D6E4F0] bg-white p-3 transition-all hover:-translate-y-0.5 hover:border-[#0695A8]"
              style={{ borderLeft: `3px solid ${scoreColor(m.score)}` }}
            >
              <p className="text-[11px] text-[#6B92AD]">{formatModuleName(m.name)}</p>
              <p className="font-display text-lg font-bold" style={{ color: scoreColor(m.score) }}>
                {m.score.toFixed(1)}
              </p>
            </Link>
          ))}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          AI INSIGHTS PANEL — below bottom row
          Visible to: Admin, Steward, ai_reviewer (view_ai_confidence)
          ═══════════════════════════════════════════════════════════════════════ */}

      {canSeeAiPanel && mdmLatest?.ai_narrative && (
        <div
          className="vx-card col-span-12 border-l-[3px] border-l-[#7C3AED]"
          style={{ animationDelay: "320ms" }}
        >
          <div className="mb-3 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[#7C3AED]" />
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#7C3AED]">
              AI Health Insights
            </h3>
            <Badge className="ml-auto bg-[#7C3AED]/10 text-[#7C3AED] text-[10px] border-0">
              Weekly Analysis
            </Badge>
          </div>

          <div className="grid grid-cols-12 gap-6">
            {/* Narrative text */}
            <div className="col-span-8">
              <p className="text-sm leading-relaxed text-[#3D6080] whitespace-pre-line">
                {mdmLatest.ai_narrative}
              </p>
            </div>

            {/* Projected Score + Risk Flags */}
            <div className="col-span-4 flex flex-col gap-4">
              {/* Projected score */}
              {mdmLatest.ai_projected_score != null && (
                <div className="rounded-lg border border-[#D6E4F0] bg-[#F0F5FA] p-4">
                  <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6B92AD]">
                    Projected Score (4 weeks)
                  </h4>
                  <div className="flex items-baseline gap-2">
                    <span
                      className="font-display text-3xl font-bold"
                      style={{ color: scoreColor(mdmLatest.ai_projected_score) }}
                    >
                      {mdmLatest.ai_projected_score.toFixed(1)}
                    </span>
                    <span className="text-sm text-[#6B92AD]">/100</span>
                    {(() => {
                      const projDelta = mdmLatest.ai_projected_score - mdmLatest.mdm_health_score;
                      if (Math.abs(projDelta) < 0.1) return null;
                      return (
                        <span className={`ml-auto flex items-center gap-1 text-xs font-medium ${projDelta >= 0 ? "text-[#059669]" : "text-[#DC2626]"}`}>
                          {projDelta >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                          {projDelta >= 0 ? "+" : ""}{projDelta.toFixed(1)}
                        </span>
                      );
                    })()}
                  </div>
                  {/* MDM sparkline with projected point */}
                  {mdmSparkline.length >= 2 && (
                    <div className="mt-2">
                      <DqsSparkline
                        data={[...mdmSparkline, { score: mdmLatest.ai_projected_score }]}
                        color="#7C3AED"
                        height={32}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Risk flags */}
              {mdmLatest.ai_risk_flags && mdmLatest.ai_risk_flags.length > 0 && (
                <div className="rounded-lg border border-[#FCA5A5] bg-[#FEF2F2] p-3">
                  <h4 className="mb-2 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#DC2626]">
                    <AlertCircle className="h-3 w-3" />
                    Risk Flags
                  </h4>
                  <ul className="space-y-1">
                    {mdmLatest.ai_risk_flags.map((flag, i) => (
                      <li key={i} className="text-xs text-[#991B1B]">
                        {flag}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── MDM Score Display ─── */
function MdmScoreDisplay({
  score,
  sparklineData,
}: {
  score: number;
  sparklineData: { score: number }[];
}) {
  const animated = useCountUp(score);

  return (
    <div>
      <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6B92AD]">
        MDM Health Score
      </h3>
      <div className="flex items-baseline gap-3">
        <span
          className="font-display text-5xl font-bold leading-none"
          style={{ color: scoreColor(score) }}
        >
          {animated.toFixed(1)}
        </span>
        <span className="font-display text-lg font-medium text-[#3D6080]">/100</span>
      </div>
      {sparklineData.length >= 2 && (
        <div className="mt-2">
          <DqsSparkline data={sparklineData} color="#0695A8" height={36} />
        </div>
      )}
    </div>
  );
}

/* ─── DQS Score Display ─── */
function ScoreDisplay({ score, delta }: { score: number; delta: number | null }) {
  const animated = useCountUp(score);

  return (
    <div>
      <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6B92AD]">
        Data Quality Score
      </h3>
      <div className="flex items-baseline gap-3">
        <span
          className="font-display text-4xl font-bold leading-none text-[#0695A8]"
        >
          {animated.toFixed(1)}
        </span>
        <span className="font-display text-base font-medium text-[#3D6080]">/100</span>
        {delta !== null && (
          <div className={`ml-auto flex items-center gap-1 text-sm font-medium ${delta >= 0 ? "text-[#059669]" : "text-[#DC2626]"}`}>
            {delta >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
            {delta >= 0 ? "+" : ""}{delta.toFixed(1)} pts
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Metric Pill ─── */
function MetricPill({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-lg border border-[#D6E4F0] bg-[#F0F5FA] px-3 py-2">
      <p className="text-[10px] font-medium uppercase tracking-wider text-[#6B92AD]">{label}</p>
      <p className="font-display text-lg font-bold" style={{ color }}>
        {value}
      </p>
    </div>
  );
}
