"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { Suspense, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { X, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { getVersions } from "@/lib/api/versions";
import { getFindings } from "@/lib/api/findings";
import {
  severityColor,
  formatModuleName,
  passRateColor,
} from "@/lib/format";
import type { Finding, Severity, Dimension } from "@/types/api";

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low"];
const DIMENSIONS: Dimension[] = [
  "completeness",
  "accuracy",
  "consistency",
  "timeliness",
  "uniqueness",
  "validity",
];
const PAGE_SIZE = 50;

function FindingsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();

  const paramVersionId = searchParams.get("version_id") ?? "";
  const paramModule = searchParams.get("module") ?? "";
  const paramSeverity = searchParams.get("severity") ?? "";
  const paramDimension = searchParams.get("dimension") ?? "";

  const [versionId, setVersionId] = useState(paramVersionId);
  const [moduleFilter, setModuleFilter] = useState(paramModule);
  const [severityFilter, setSeverityFilter] = useState(paramSeverity);
  const [dimensionFilter, setDimensionFilter] = useState(paramDimension);
  const [page, setPage] = useState(0);
  const [selectedFinding, setSelectedFinding] = useState<Finding | null>(null);

  const { data: versionData } = useQuery({
    queryKey: ["versions-list"],
    queryFn: () => getVersions({ limit: 50 }),
  });
  const completedVersions = (versionData?.versions ?? []).filter(
    (v) => v.status === "agents_complete" || v.status === "complete"
  );

  // Auto-select latest version if none specified
  const activeVersionId =
    versionId || completedVersions[0]?.id || "";

  const {
    data: findingsData,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: [
      "findings",
      activeVersionId,
      moduleFilter,
      severityFilter,
      dimensionFilter,
      page,
    ],
    queryFn: () =>
      getFindings({
        version_id: activeVersionId,
        module: moduleFilter || undefined,
        severity: severityFilter || undefined,
        dimension: dimensionFilter || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
    enabled: !!activeVersionId,
  });

  const updateUrl = (params: Record<string, string>) => {
    const sp = new URLSearchParams(searchParams.toString());
    Object.entries(params).forEach(([k, v]) => {
      if (v) sp.set(k, v);
      else sp.delete(k);
    });
    router.push(`/findings?${sp.toString()}`);
  };

  const clearFilters = () => {
    setModuleFilter("");
    setSeverityFilter("");
    setDimensionFilter("");
    setPage(0);
    router.push(`/findings${activeVersionId ? `?version_id=${activeVersionId}` : ""}`);
  };

  const totalPages = findingsData
    ? Math.ceil(findingsData.total / PAGE_SIZE)
    : 0;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Findings</h1>

      {/* Filter bar */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 py-3">
          {/* Version selector */}
          <select
            value={activeVersionId}
            onChange={(e) => {
              setVersionId(e.target.value);
              setPage(0);
              updateUrl({ version_id: e.target.value });
            }}
            className="rounded-md border border-border bg-accent px-3 py-1.5 text-sm"
          >
            <option value="">Select version...</option>
            {completedVersions.map((v) => (
              <option key={v.id} value={v.id}>
                {new Date(v.run_at).toLocaleDateString()} {v.label ? `— ${v.label}` : ""}
              </option>
            ))}
          </select>

          {/* Module filter */}
          <select
            value={moduleFilter}
            onChange={(e) => {
              setModuleFilter(e.target.value);
              setPage(0);
            }}
            className="rounded-md border border-border bg-accent px-3 py-1.5 text-sm"
          >
            <option value="">All modules</option>
            <option value="business_partner">Business Partner</option>
            <option value="material_master">Material Master</option>
            <option value="fi_gl">GL Accounts</option>
          </select>

          {/* Severity pills */}
          <div className="flex gap-1">
            {SEVERITIES.map((s) => (
              <button
                key={s}
                onClick={() => {
                  setSeverityFilter(severityFilter === s ? "" : s);
                  setPage(0);
                }}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  severityFilter === s
                    ? severityColor(s)
                    : "bg-accent text-muted-foreground hover:text-foreground"
                }`}
              >
                {s}
              </button>
            ))}
          </div>

          {/* Dimension pills */}
          <div className="flex gap-1">
            {DIMENSIONS.map((d) => (
              <button
                key={d}
                onClick={() => {
                  setDimensionFilter(dimensionFilter === d ? "" : d);
                  setPage(0);
                }}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  dimensionFilter === d
                    ? "bg-[#0F6E56] text-white"
                    : "bg-accent text-muted-foreground hover:text-foreground"
                }`}
              >
                {d}
              </button>
            ))}
          </div>

          {(moduleFilter || severityFilter || dimensionFilter) && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <X className="mr-1 h-3 w-3" /> Clear
            </Button>
          )}

          <span className="ml-auto text-xs text-muted-foreground">
            {findingsData
              ? `Showing ${Math.min(page * PAGE_SIZE + 1, findingsData.total)}–${Math.min((page + 1) * PAGE_SIZE, findingsData.total)} of ${findingsData.total} findings`
              : ""}
          </span>
        </CardContent>
      </Card>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : error ? (
        <Alert variant="destructive">
          <AlertDescription>
            Failed to load findings.{" "}
            <Button variant="link" className="px-0" onClick={() => refetch()}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="px-4 py-3">Severity</th>
                    <th className="px-4 py-3">Module</th>
                    <th className="px-4 py-3">Check</th>
                    <th className="px-4 py-3">Message</th>
                    <th className="px-4 py-3 text-right">Affected / Total</th>
                    <th className="w-32 px-4 py-3">Pass Rate</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {findingsData?.findings.map((f) => (
                    <tr
                      key={f.id}
                      className="border-b border-border/50 hover:bg-accent/30"
                    >
                      <td className="px-4 py-3">
                        <Badge className={severityColor(f.severity)}>
                          {f.severity}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        {formatModuleName(f.module)}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">
                        {f.check_id}
                      </td>
                      <td className="max-w-xs truncate px-4 py-3">
                        {f.details?.message ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {f.affected_count.toLocaleString()} / {f.total_count.toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        {f.pass_rate != null ? (
                          <div className="flex items-center gap-2">
                            <Progress
                              value={f.pass_rate}
                              className={`h-2 ${passRateColor(f.pass_rate)}`}
                            />
                            <span className="text-xs">
                              {f.pass_rate.toFixed(1)}%
                            </span>
                          </div>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedFinding(f)}
                        >
                          View detail
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
          >
            <ChevronLeft className="h-4 w-4" /> Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page + 1} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages - 1}
            onClick={() => setPage(page + 1)}
          >
            Next <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Detail sheet — w-2/3 on desktop, full on mobile */}
      <Sheet
        open={!!selectedFinding}
        onOpenChange={(open) => {
          if (!open) setSelectedFinding(null);
        }}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl lg:w-2/3">
          {selectedFinding && (
            <FindingDetail
              finding={selectedFinding}
              onRefresh={() => {
                refetch().then((result) => {
                  const updated = result.data?.findings.find(
                    (f) => f.id === selectedFinding.id,
                  );
                  if (updated) setSelectedFinding(updated);
                });
              }}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function FindingDetail({
  finding,
  onRefresh,
}: {
  finding: Finding;
  onRefresh: () => void;
}) {
  const samples = finding.details?.sample_failing_records ?? [];
  const distinctInvalid = finding.details?.distinct_invalid_values as
    | Record<string, number>
    | undefined;

  // Extract SAP transaction from remediation text
  const sapTxMatch = finding.remediation_text?.match(
    /SAP Transaction:\s*(.+?)(?:\n|$)/,
  );
  const sapTx = sapTxMatch?.[1]?.trim();

  // Extract estimated effort
  const effortMatch = finding.remediation_text?.match(
    /Estimated Effort:\s*(.+?)(?:\n|$)/,
  );
  const effort = effortMatch?.[1]?.trim();

  // Clean remediation text (remove the metadata lines for display)
  const cleanRemediation = finding.remediation_text
    ?.replace(/\n\nSAP Transaction:.*$/s, "")
    ?.trim();

  return (
    <div className="space-y-6">
      {/* SECTION 1: Summary */}
      <SheetHeader>
        <SheetTitle className="font-mono text-lg">{finding.check_id}</SheetTitle>
      </SheetHeader>

      <p className="text-sm leading-relaxed">
        {finding.details?.message ?? "—"}
      </p>

      <div className="flex flex-wrap gap-2">
        <Badge className={severityColor(finding.severity)}>
          {finding.severity}
        </Badge>
        <Badge variant="outline">{finding.dimension}</Badge>
        {finding.details?.field_checked && (
          <Badge variant="secondary" className="font-mono text-xs">
            {String(finding.details.field_checked)}
          </Badge>
        )}
        {sapTx && (
          <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-200">
            SAP Transaction: {sapTx}
          </Badge>
        )}
        {effort && (
          <Badge variant="outline" className="text-xs">
            {effort}
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <span className="text-muted-foreground">Affected Records</span>
          <p className="text-lg font-bold">
            {finding.affected_count.toLocaleString()} of{" "}
            {finding.total_count.toLocaleString()}
          </p>
        </div>
        <div>
          <span className="text-muted-foreground">Pass Rate</span>
          <div className="mt-1 flex items-center gap-2">
            <Progress
              value={finding.pass_rate ?? 0}
              className={`h-2.5 ${passRateColor(finding.pass_rate ?? 0)}`}
            />
            <span className="text-lg font-bold">
              {finding.pass_rate != null
                ? `${finding.pass_rate.toFixed(1)}%`
                : "—"}
            </span>
          </div>
        </div>
      </div>

      {/* SECTION 2: Failing records */}
      <div>
        <h4 className="mb-2 text-sm font-semibold">
          {samples.length > 0
            ? `Sample Failing Records (showing up to ${Math.min(samples.length, 10)})`
            : "Record Detail"}
        </h4>

        {samples.length > 0 ? (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-accent">
                  {Object.keys(samples[0]).map((k) => (
                    <th key={k} className="px-3 py-2 text-left font-medium">
                      {k}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {samples.slice(0, 10).map((row, i) => (
                  <tr
                    key={i}
                    className="border-b border-border/50 hover:bg-accent/30"
                  >
                    {Object.values(row).map((v, j) => (
                      <td key={j} className="px-3 py-1.5 font-mono">
                        {String(v ?? "null")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm italic text-muted-foreground">
            Record detail not available for this check.
          </p>
        )}
      </div>

      {/* Distinct invalid values (for domain_value_check) */}
      {distinctInvalid && Object.keys(distinctInvalid).length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-semibold">
            Most Common Invalid Values
          </h4>
          <div className="flex flex-wrap gap-2">
            {Object.entries(distinctInvalid)
              .slice(0, 10)
              .map(([val, count]) => (
                <Badge
                  key={val}
                  variant="outline"
                  className="font-mono text-xs"
                >
                  {val === "" ? "''" : `"${val}"`}: {count.toLocaleString()}
                </Badge>
              ))}
          </div>
        </div>
      )}

      {/* SECTION 3: Remediation guidance */}
      {cleanRemediation ? (
        <Card className="border-[#0F6E56]/30 bg-[#0F6E56]/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">How to Fix This</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1 text-sm">
              {cleanRemediation.split("\n").map((line, i) => (
                <p key={i} className={line.trim() === "" ? "h-2" : ""}>
                  {line}
                </p>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-6 text-center">
            <p className="text-sm text-muted-foreground">
              Remediation guidance is being generated. Refresh in a moment.
            </p>
            <Button variant="outline" size="sm" onClick={onRefresh}>
              <RefreshCw className="mr-1.5 h-3 w-3" />
              Refresh findings
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function FindingsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <FindingsContent />
    </Suspense>
  );
}
