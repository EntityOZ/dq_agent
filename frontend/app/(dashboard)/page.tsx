"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Upload as UploadIcon, AlertTriangle, TrendingUp, TrendingDown, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { getVersions } from "@/lib/api/versions";
import { getFindings } from "@/lib/api/findings";
import { scoreColor, formatModuleName, relativeTime } from "@/lib/format";
import { useCountUp } from "@/hooks/use-count-up";
import { DqsSparkline } from "@/components/charts/dqs-sparkline";
import { DqsBarChart } from "@/components/charts/dqs-bar-chart";
import { DimensionDonut } from "@/components/charts/dimension-donut";
import { SeverityBarChart } from "@/components/charts/severity-bar-chart";
import type { Version, DQSSummary, DimensionScores } from "@/types/api";

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

export default function DashboardPage() {
  const {
    data: versionData,
    isLoading: versionsLoading,
    error: versionsError,
    refetch: refetchVersions,
  } = useQuery({
    queryKey: ["versions", { limit: 20 }],
    queryFn: () => getVersions({ limit: 20 }),
  });

  const versions = versionData?.versions ?? [];
  const completed = versions.filter((v) => v.status === "agents_complete" && v.dqs_summary);
  const latestComplete = completed[0];

  const {
    data: criticalFindings,
  } = useQuery({
    queryKey: ["critical-findings", latestComplete?.id],
    queryFn: () =>
      getFindings({
        version_id: latestComplete!.id,
        severity: "critical",
        limit: 10,
      }),
    enabled: !!latestComplete,
  });

  if (versionsLoading) {
    return (
      <div className="grid grid-cols-12 gap-5">
        <Skeleton className="col-span-5 h-72 rounded-xl" />
        <Skeleton className="col-span-7 h-72 rounded-xl" />
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

  if (!latestComplete || !latestComplete.dqs_summary) {
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

  const dqs = latestComplete.dqs_summary;
  const overallScore = averageDqs(dqs);
  const dimensions = averageDimensions(dqs);
  const severityCounts = aggregateSeverityCounts(dqs);

  // Trend data
  const sparklineData = completed
    .slice(0, 10)
    .reverse()
    .map((v) => ({ score: averageDqs(v.dqs_summary!) }));

  const prevComplete = completed[1];
  const prevScore = prevComplete?.dqs_summary ? averageDqs(prevComplete.dqs_summary) : null;
  const delta = prevScore !== null ? Math.round((overallScore - prevScore) * 10) / 10 : null;

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

  return (
    <div className="grid grid-cols-12 gap-5">
      {/* ─── TOP LEFT: DQS Score Card ─── */}
      <div
        className="vx-card col-span-5 row-span-2 flex flex-col gap-5 border-t-[3px] border-t-[#0695A8]"
        style={{ animationDelay: "0ms" }}
      >
        <ScoreDisplay score={overallScore} delta={delta} />
        <DqsSparkline data={sparklineData} />

        {/* Top Modules */}
        <div>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6B92AD]">
            Top Modules
          </h3>
          <div className="space-y-2">
            {moduleEntries.slice(0, 5).map((m, i) => (
              <Link
                key={m.name}
                href={`/findings?module=${m.name}&version_id=${latestComplete.id}`}
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

        <div className="mt-auto text-xs text-[#6B92AD]">
          Last analysed: {relativeTime(latestComplete.run_at)}
          {latestComplete.label && (
            <span className="ml-1 text-[#3D6080]">— {latestComplete.label}</span>
          )}
        </div>
      </div>

      {/* ─── TOP RIGHT: DQS Over Time ─── */}
      <div
        className="vx-card col-span-7 row-span-2 flex flex-col"
        style={{ animationDelay: "60ms" }}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6B92AD]">
            DQS Over Time
          </h3>
          <div className="flex gap-1">
            {["Overview", "Health Trend", "Risks"].map((tab, i) => (
              <button
                key={tab}
                className={`rounded-full px-3 py-1 text-[11px] font-medium transition-colors ${
                  i === 0
                    ? "bg-[#0695A8] text-white"
                    : "text-[#6B92AD] hover:bg-[#F0F5FA]"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1" style={{ minHeight: 240 }}>
          {barData.length >= 2 ? (
            <DqsBarChart data={barData} />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-[#6B92AD]">
              Upload data at least twice to see trends
            </div>
          )}
        </div>
      </div>

      {/* ─── BOTTOM LEFT: Health by Dimension ─── */}
      <div
        className="vx-card col-span-4 flex flex-col items-center"
        style={{ animationDelay: "120ms" }}
      >
        <h3 className="mb-3 self-start text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6B92AD]">
          Health by Dimension
        </h3>
        <DimensionDonut dimensions={dimensions} overallScore={overallScore} />
      </div>

      {/* ─── BOTTOM CENTRE: Findings by Severity ─── */}
      <div
        className="vx-card col-span-4"
        style={{ animationDelay: "180ms" }}
      >
        <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6B92AD]">
          Findings by Severity
        </h3>
        <div style={{ height: 180 }}>
          <SeverityBarChart counts={severityCounts} />
        </div>
      </div>

      {/* ─── BOTTOM RIGHT: Module Health Grid ─── */}
      <div
        className="vx-card col-span-4"
        style={{ animationDelay: "240ms" }}
      >
        <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6B92AD]">
          Module Health
        </h3>
        <div className="grid grid-cols-2 gap-2">
          {moduleEntries.map((m) => (
            <Link
              key={m.name}
              href={`/findings?module=${m.name}&version_id=${latestComplete.id}`}
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
    </div>
  );
}

/* ─── Score Display sub-component ─── */
function ScoreDisplay({ score, delta }: { score: number; delta: number | null }) {
  const animated = useCountUp(score);

  return (
    <div className="flex items-baseline gap-3">
      <span
        className="font-display text-7xl font-bold leading-none text-[#0695A8]"
        style={{ animation: "vx-count-up 0.5s ease-out" }}
      >
        {animated.toFixed(1)}
      </span>
      <div className="flex flex-col">
        <span className="font-display text-lg font-medium text-[#3D6080]">/100</span>
        <span className="text-xs text-[#6B92AD]">Data Quality Score</span>
      </div>
      {delta !== null && (
        <div className={`ml-auto flex items-center gap-1 text-sm font-medium ${delta >= 0 ? "text-[#059669]" : "text-[#DC2626]"}`}>
          {delta >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
          {delta >= 0 ? "+" : ""}{delta.toFixed(1)} pts
        </div>
      )}
    </div>
  );
}
