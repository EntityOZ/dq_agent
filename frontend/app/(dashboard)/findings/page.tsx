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
import { getFindings, getFindingReportContext } from "@/lib/api/findings";
import {
  severityColor,
  formatModuleName,
  passRateColor,
} from "@/lib/format";
import { Copy, Check } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertTitle } from "@/components/ui/alert";
import type { Finding, Severity, Dimension, FindingReportContext } from "@/types/api";

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
        <SheetContent className="w-full overflow-y-auto sm:max-w-4xl lg:w-3/4">
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

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-6 px-1.5"
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? (
        <Check className="h-3 w-3 text-green-600" />
      ) : (
        <Copy className="h-3 w-3" />
      )}
    </Button>
  );
}

function authorityVariant(
  authority: string,
): "destructive" | "secondary" | "outline" | "default" {
  switch (authority) {
    case "sap_hard_constraint":
      return "destructive";
    case "s4hana_migration":
      return "default";
    case "best_practice":
      return "secondary";
    case "customer_configured":
      return "outline";
    default:
      return "outline";
  }
}

function authorityLabel(authority: string): string {
  switch (authority) {
    case "sap_hard_constraint":
      return "SAP Hard Constraint";
    case "s4hana_migration":
      return "S/4HANA Migration Requirement";
    case "best_practice":
      return "Best Practice";
    case "customer_configured":
      return "Customer Configured";
    default:
      return authority;
  }
}

function FindingDetail({
  finding,
  onRefresh,
}: {
  finding: Finding;
  onRefresh: () => void;
}) {
  const samples = finding.details?.sample_failing_records ?? [];
  const distinctInvalid = finding.details?.distinct_invalid_values;
  const ruleCtx = finding.rule_context;
  const valueFixes = finding.value_fix_map;
  const recordFixes = finding.record_fixes;
  const checkField = finding.details?.field_checked as string | undefined;

  // Fetch report context for Panel 3
  const { data: reportCtxData } = useQuery({
    queryKey: ["finding-report-context", finding.id],
    queryFn: () => getFindingReportContext(finding.id),
    enabled: !!finding.id,
  });
  const reportCtx = reportCtxData?.report_context;

  return (
    <div className="space-y-6">
      {/* Header */}
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
        {checkField && (
          <Badge variant="secondary" className="font-mono text-xs">
            {checkField}
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

      {/* ─── PANEL 1: Why this rule exists ─── */}
      {ruleCtx && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Why this rule exists</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Badge variant={authorityVariant(ruleCtx.rule_authority)}>
              {authorityLabel(ruleCtx.rule_authority)}
            </Badge>

            <p className="text-sm leading-relaxed">{ruleCtx.why_it_matters}</p>

            {finding.severity === "critical" && ruleCtx.sap_impact ? (
              <Alert variant="destructive">
                <AlertTitle>SAP impact</AlertTitle>
                <AlertDescription>{ruleCtx.sap_impact}</AlertDescription>
              </Alert>
            ) : ruleCtx.sap_impact ? (
              <p className="text-sm text-muted-foreground">
                <span className="font-medium">SAP impact:</span>{" "}
                {ruleCtx.sap_impact}
              </p>
            ) : null}

            {ruleCtx.valid_values_with_labels &&
              Object.keys(ruleCtx.valid_values_with_labels).length > 0 && (
                <div>
                  <h4 className="mb-1 text-xs font-semibold">Valid values</h4>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-20">Code</TableHead>
                        <TableHead>Meaning</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {Object.entries(ruleCtx.valid_values_with_labels).map(
                        ([code, label]) => (
                          <TableRow key={code}>
                            <TableCell>
                              <code className="text-xs">{code}</code>
                            </TableCell>
                            <TableCell className="text-xs">{label}</TableCell>
                          </TableRow>
                        ),
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}
          </CardContent>
        </Card>
      )}

      {/* ─── PANEL 2: Failing records with recommended fix ─── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">
            Failing records
            <span className="ml-1 font-normal text-muted-foreground">
              (showing {Math.min(samples.length, 10)} of{" "}
              {finding.affected_count.toLocaleString()})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {samples.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Record ID</TableHead>
                    <TableHead>Field</TableHead>
                    <TableHead>Invalid value</TableHead>
                    <TableHead>Recommended fix</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {samples.slice(0, 10).map((record, idx) => {
                    const fix = recordFixes?.[idx];
                    const idField =
                      finding.details?.id_field_used as string | undefined;
                    const invalidVal = checkField
                      ? String(record[checkField] ?? "")
                      : "";
                    const valueFix = valueFixes?.[invalidVal];

                    return (
                      <TableRow key={idx}>
                        <TableCell className="font-mono text-xs">
                          {fix?.record_id ??
                            (idField ? String(record[idField] ?? "") : "—")}
                        </TableCell>
                        <TableCell className="text-xs">
                          {checkField ?? "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="font-mono text-xs">
                            {invalidVal === "" ? (
                              <em>blank</em>
                            ) : (
                              invalidVal
                            )}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-sm text-xs">
                          <div className="space-y-1">
                            <p>
                              {fix?.fix_instruction ??
                                valueFix?.fix_instruction ??
                                "—"}
                            </p>
                            {fix?.sql_statement && (
                              <div className="flex items-center gap-1 rounded bg-accent p-1.5">
                                <code className="text-[11px]">
                                  {fix.sql_statement}
                                </code>
                                <CopyButton text={fix.sql_statement} />
                              </div>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-sm italic text-muted-foreground">
              Record detail not available for this check.
            </p>
          )}

          {/* Distinct invalid values summary */}
          {distinctInvalid &&
            Object.keys(distinctInvalid).length > 1 && (
              <div>
                <h5 className="mb-2 text-xs font-semibold">
                  All invalid values found in this dataset
                </h5>
                <div className="space-y-1">
                  {Object.entries(distinctInvalid)
                    .sort((a, b) => b[1] - a[1])
                    .map(([val, count]) => {
                      const fix = valueFixes?.[val];
                      return (
                        <div
                          key={val}
                          className="flex items-center gap-2 text-xs"
                        >
                          <Badge variant="outline" className="font-mono">
                            {val === "" ? "blank" : val}
                          </Badge>
                          <span className="text-muted-foreground">
                            {count.toLocaleString()} records
                          </span>
                          {fix?.fix_instruction && (
                            <span className="truncate text-muted-foreground">
                              {fix.fix_instruction.slice(0, 80)}
                              {fix.fix_instruction.length > 80 ? "..." : ""}
                            </span>
                          )}
                        </div>
                      );
                    })}
                </div>
              </div>
            )}
        </CardContent>
      </Card>

      {/* ─── PANEL 3: Remediation guidance (updated) ─── */}
      <Card className="border-[#0F6E56]/30 bg-[#0F6E56]/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Remediation guidance</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {reportCtx ? (
            <>
              {/* Effort estimate */}
              {reportCtx.effort_estimate && (
                <div className="flex items-center gap-3 rounded-md border border-border bg-background p-3">
                  <div>
                    <span className="text-xs text-muted-foreground">
                      Estimated effort
                    </span>
                    <p className="text-lg font-bold">
                      {reportCtx.effort_estimate.estimated_person_hours}{" "}
                      person-hours
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {reportCtx.effort_estimate.estimation_basis}
                    </p>
                  </div>
                  <Badge variant="secondary">
                    {reportCtx.effort_estimate.fix_complexity} complexity
                  </Badge>
                </div>
              )}

              {/* Fix sequence position */}
              {reportCtx.fix_sequence && (
                <div className="rounded-md border border-border bg-background p-3">
                  <span className="text-sm font-medium">
                    Fix priority: #{reportCtx.fix_sequence.sequence}
                  </span>
                  <p className="text-xs text-muted-foreground">
                    {reportCtx.fix_sequence.reason}
                  </p>
                </div>
              )}

              {/* Cross-finding patterns */}
              {reportCtx.cross_finding_patterns.length > 0 && (
                <div>
                  <h5 className="mb-1 text-xs font-semibold">
                    Connected to other findings
                  </h5>
                  {reportCtx.cross_finding_patterns.map((p, i) => (
                    <div
                      key={i}
                      className="mb-2 rounded-md border border-border bg-background p-3"
                    >
                      <p className="text-sm">{p.pattern_description}</p>
                      <p className="text-xs text-muted-foreground">
                        Affects {p.shared_record_count.toLocaleString()} records
                        across {p.affected_check_ids.join(", ")}
                      </p>
                      <p className="text-xs">{p.recommended_approach}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Flags */}
              {reportCtx.flags.length > 0 && (
                <Alert>
                  <AlertTitle>Note from AI analysis</AlertTitle>
                  {reportCtx.flags.map((f, i) => (
                    <AlertDescription key={i}>{f.flag}</AlertDescription>
                  ))}
                </Alert>
              )}

              {/* No data from report yet */}
              {!reportCtx.effort_estimate &&
                !reportCtx.fix_sequence &&
                reportCtx.cross_finding_patterns.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No cross-finding patterns detected for this check.
                  </p>
                )}
            </>
          ) : (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <p className="text-sm text-muted-foreground">
                Strategic remediation analysis is being generated.
              </p>
              <Button variant="outline" size="sm" onClick={onRefresh}>
                <RefreshCw className="mr-1.5 h-3 w-3" />
                Refresh
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
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
