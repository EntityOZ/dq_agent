"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  RadialBarChart,
  RadialBar,
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { Upload as UploadIcon, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { getVersions } from "@/lib/api/versions";
import { getFindings } from "@/lib/api/findings";
import {
  scoreColor,
  scoreBg,
  formatModuleName,
  relativeTime,
  severityColor,
} from "@/lib/format";
import type { Version, DQSSummary } from "@/types/api";

function averageDqs(summary: Record<string, DQSSummary>): number {
  const scores = Object.values(summary).map((m) => m.composite_score);
  if (scores.length === 0) return 0;
  return Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10;
}

export default function DashboardPage() {
  const {
    data: versionData,
    isLoading: versionsLoading,
    error: versionsError,
    refetch: refetchVersions,
  } = useQuery({
    queryKey: ["versions", { limit: 10 }],
    queryFn: () => getVersions({ limit: 10 }),
  });

  const versions = versionData?.versions ?? [];
  const latestComplete = versions.find((v) => v.status === "agents_complete");

  const {
    data: criticalFindings,
    isLoading: findingsLoading,
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
      <div className="space-y-6">
        <Skeleton className="h-64 w-full" />
        <div className="grid grid-cols-3 gap-4">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
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

  // Empty state
  if (!latestComplete || !latestComplete.dqs_summary) {
    return (
      <div className="flex flex-col items-center justify-center gap-6 py-24">
        <UploadIcon className="h-16 w-16 text-muted-foreground" />
        <h2 className="text-xl font-semibold">No analysis data yet</h2>
        <p className="text-muted-foreground">
          Upload SAP data to get your first Data Quality Score.
        </p>
        <Link href="/upload">
          <Button>Upload Data</Button>
        </Link>
      </div>
    );
  }

  const dqs = latestComplete.dqs_summary;
  const overallScore = averageDqs(dqs);
  const color = scoreColor(overallScore);

  return (
    <div className="space-y-8">
      {/* Section 1 — DQS Gauge */}
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-8">
          <div className="relative h-52 w-52">
            <ResponsiveContainer>
              <RadialBarChart
                cx="50%"
                cy="50%"
                innerRadius="70%"
                outerRadius="100%"
                startAngle={180}
                endAngle={0}
                data={[{ value: overallScore, fill: color }]}
              >
                <RadialBar dataKey="value" cornerRadius={8} background={{ fill: "#2A2A45" }} />
              </RadialBarChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-4xl font-bold" style={{ color }}>
                {overallScore}
              </span>
              <span className="text-xs text-muted-foreground">DQS Score</span>
            </div>
          </div>
          <div className="text-center text-sm text-muted-foreground">
            Last analysed: {relativeTime(latestComplete.run_at)}
            {latestComplete.label && (
              <span className="ml-2 text-foreground">— {latestComplete.label}</span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Section 2 — Module Heatmap */}
      <div>
        <h2 className="mb-4 text-lg font-semibold">Module Scores</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Object.entries(dqs).map(([module, summary]) => (
            <Link
              key={module}
              href={`/findings?module=${module}&version_id=${latestComplete.id}`}
            >
              <Card className="cursor-pointer transition-colors hover:border-[#0F6E56]">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">
                    {formatModuleName(module)}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex items-baseline gap-2">
                    <span
                      className="text-2xl font-bold"
                      style={{ color: scoreColor(summary.composite_score) }}
                    >
                      {summary.composite_score}
                    </span>
                    <span className="text-xs text-muted-foreground">/ 100</span>
                  </div>
                  <div className="flex gap-2">
                    {summary.critical_count > 0 && (
                      <Badge variant="destructive" className="text-xs">
                        {summary.critical_count} critical
                      </Badge>
                    )}
                    {summary.capped && (
                      <Badge variant="outline" className="text-xs text-amber-400">
                        capped
                      </Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>

      {/* Section 3 — Trend Sparklines */}
      <TrendSection versions={versions} />

      {/* Section 4 — Recent Critical Findings */}
      {criticalFindings && criticalFindings.findings.length > 0 && (
        <div>
          <h2 className="mb-4 text-lg font-semibold">Recent Critical Findings</h2>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="px-4 py-3">Module</th>
                      <th className="px-4 py-3">Check</th>
                      <th className="px-4 py-3">Message</th>
                      <th className="px-4 py-3 text-right">Affected</th>
                      <th className="px-4 py-3 text-right">Pass Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {criticalFindings.findings.map((f) => (
                      <tr key={f.id} className="border-b border-border/50 hover:bg-accent/30">
                        <td className="px-4 py-3">{formatModuleName(f.module)}</td>
                        <td className="px-4 py-3 font-mono text-xs">{f.check_id}</td>
                        <td className="max-w-xs truncate px-4 py-3">
                          {f.details?.message ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-right">{f.affected_count}</td>
                        <td className="px-4 py-3 text-right">
                          {f.pass_rate != null ? `${f.pass_rate.toFixed(1)}%` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function TrendSection({ versions }: { versions: Version[] }) {
  const completed = versions.filter(
    (v) => v.status === "agents_complete" && v.dqs_summary
  );

  if (completed.length < 2) {
    return (
      <div>
        <h2 className="mb-4 text-lg font-semibold">Trends</h2>
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Not enough data for trend analysis. Upload data at least twice to see
            trends.
          </CardContent>
        </Card>
      </div>
    );
  }

  // Collect all modules
  const modules = new Set<string>();
  completed.forEach((v) => {
    if (v.dqs_summary) Object.keys(v.dqs_summary).forEach((m) => modules.add(m));
  });

  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold">Trends</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[...modules].map((module) => {
          const points = completed
            .filter((v) => v.dqs_summary?.[module])
            .reverse()
            .map((v) => ({
              date: new Date(v.run_at).toLocaleDateString(),
              score: v.dqs_summary![module].composite_score,
            }));
          const latest = points[points.length - 1]?.score ?? 0;
          return (
            <Card key={module}>
              <CardHeader className="pb-1">
                <CardTitle className="text-sm">{formatModuleName(module)}</CardTitle>
              </CardHeader>
              <CardContent className="h-24">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={points}>
                    <XAxis dataKey="date" hide />
                    <YAxis domain={[0, 100]} hide />
                    <Tooltip />
                    <Line
                      type="monotone"
                      dataKey="score"
                      stroke={scoreColor(latest)}
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
