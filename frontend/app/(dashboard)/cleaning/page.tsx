"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Sparkles,
  CheckCircle2,
  Clock,
  Undo2,
  ChevronLeft,
  ChevronRight,
  X,
  Search,
  Download,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  getCleaningQueue,
  getCleaningItem,
  approveCleaning,
  rejectCleaning,
  applyCleaning,
  rollbackCleaning,
  getCleaningMetrics,
  downloadCleaningExport,
  type CleaningQueueItem,
  type ExportFormat,
} from "@/lib/api/cleaning";
import { toast } from "sonner";

const PAGE_SIZE = 20;

const STATUS_COLORS: Record<string, string> = {
  detected: "bg-[#DBEAFE] text-[#1D6ECC] border border-[#93C5FD]",
  recommended: "bg-[#FEF3C7] text-[#D97706] border border-[#FCD34D]",
  in_review: "bg-[#FFF9C4] text-[#B45309] border border-[#FDE68A]",
  approved: "bg-[#CCEFF1] text-[#0695A8] border border-[#99D9E0]",
  applied: "bg-[#D1FAE5] text-[#059669] border border-[#6EE7B7]",
  verified: "bg-[#D1FAE5] text-[#047857] border border-[#34D399]",
  rejected: "bg-[#FEE2E2] text-[#DC2626] border border-[#FCA5A5]",
  rolled_back: "bg-[#F0F5FA] text-[#6B92AD] border border-[#D6E4F0]",
};

function confidenceColor(c: number): string {
  if (c >= 85) return "text-[#059669]";
  if (c >= 60) return "text-[#D97706]";
  return "text-[#DC2626]";
}

export default function CleaningPage() {
  const queryClient = useQueryClient();
  const [objectType, setObjectType] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [searchKey, setSearchKey] = useState("");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("csv");
  const [exportLoading, setExportLoading] = useState(false);
  const [approveValue, setApproveValue] = useState<string | null>(null);

  const { data: metricsData } = useQuery({
    queryKey: ["cleaning-metrics"],
    queryFn: () => getCleaningMetrics("weekly"),
    staleTime: 60_000,
  });

  const { data: queueData, isLoading } = useQuery({
    queryKey: ["cleaning-queue", objectType, statusFilter, page],
    queryFn: () =>
      getCleaningQueue({
        object_type: objectType || undefined,
        status: statusFilter || undefined,
        page,
        per_page: PAGE_SIZE,
      }),
  });

  const { data: detailData, isLoading: isDetailLoading } = useQuery({
    queryKey: ["cleaning-item", selectedId],
    queryFn: () => getCleaningItem(selectedId!),
    enabled: !!selectedId,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["cleaning-queue"] });
    queryClient.invalidateQueries({ queryKey: ["cleaning-item", selectedId] });
    queryClient.invalidateQueries({ queryKey: ["cleaning-metrics"] });
  };

  const approveMut = useMutation({
    mutationFn: (id: string) => approveCleaning(id),
    onSuccess: () => { toast.success("Approved"); invalidate(); },
  });

  const rejectMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => rejectCleaning(id, reason),
    onSuccess: () => { toast.success("Rejected"); invalidate(); setRejectReason(""); },
  });

  const applyMut = useMutation({
    mutationFn: (id: string) => applyCleaning(id),
    onSuccess: () => { toast.success("Applied"); invalidate(); },
  });

  const rollbackMut = useMutation({
    mutationFn: (id: string) => rollbackCleaning(id),
    onSuccess: () => { toast.success("Rolled back"); invalidate(); },
  });

  const totals = metricsData?.totals;
  const items = queueData?.items ?? [];
  const totalItems = queueData?.total ?? 0;
  const totalPages = Math.ceil(totalItems / PAGE_SIZE);
  const detail = detailData;

  // Filter by search key client-side
  const filtered = searchKey
    ? items.filter((i) => i.record_key.toLowerCase().includes(searchKey.toLowerCase()))
    : items;

  const rollbackTimeLeft = (item: CleaningQueueItem) => {
    if (!item.rollback_deadline) return null;
    const ms = new Date(item.rollback_deadline).getTime() - Date.now();
    if (ms <= 0) return null;
    const hours = Math.floor(ms / 3_600_000);
    const mins = Math.floor((ms % 3_600_000) / 60_000);
    return `${hours}h ${mins}m`;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Cleaning Workbench</h1>
        <Button onClick={() => setExportOpen(true)} variant="outline">
          <Download className="mr-2 h-4 w-4" /> Export
        </Button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-[#1D6ECC]" />
              <span className="text-sm text-muted-foreground">Detected</span>
            </div>
            <p className="mt-1 text-2xl font-bold">{totals?.detected ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-[#D97706]" />
              <span className="text-sm text-muted-foreground">Pending Review</span>
            </div>
            <p className="mt-1 text-2xl font-bold">{totals?.recommended ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-[#059669]" />
              <span className="text-sm text-muted-foreground">Applied This Week</span>
            </div>
            <p className="mt-1 text-2xl font-bold">{totals?.applied ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-[#0695A8]" />
              <span className="text-sm text-muted-foreground">Auto-approved</span>
            </div>
            <p className="mt-1 text-2xl font-bold">{totals?.auto_approved ?? 0}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filter bar */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 py-3">
          <select
            value={objectType}
            onChange={(e) => { setObjectType(e.target.value); setPage(1); }}
            className="rounded-md border border-border bg-accent px-3 py-1.5 text-sm"
          >
            <option value="">All object types</option>
            <option value="business_partner">Business Partner</option>
            <option value="material">Material</option>
            <option value="customer">Customer</option>
            <option value="vendor">Vendor</option>
            <option value="employee">Employee</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="rounded-md border border-border bg-accent px-3 py-1.5 text-sm"
          >
            <option value="">All statuses</option>
            <option value="detected">Detected</option>
            <option value="recommended">Recommended</option>
            <option value="in_review">In Review</option>
            <option value="approved">Approved</option>
            <option value="applied">Applied</option>
            <option value="rejected">Rejected</option>
            <option value="rolled_back">Rolled Back</option>
          </select>

          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search record key..."
              value={searchKey}
              onChange={(e) => setSearchKey(e.target.value)}
              className="rounded-md border border-border bg-accent py-1.5 pl-7 pr-3 text-sm"
            />
          </div>

          {(objectType || statusFilter || searchKey) && (
            <Button variant="ghost" size="sm" onClick={() => { setObjectType(""); setStatusFilter(""); setSearchKey(""); setPage(1); }}>
              <X className="mr-1 h-3 w-3" /> Clear
            </Button>
          )}

          <span className="ml-auto text-xs text-muted-foreground">
            {totalItems} total items
          </span>
        </CardContent>
      </Card>

      {/* Main table */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="px-4 py-3">Record Key</th>
                    <th className="px-4 py-3">Object Type</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3 text-right">Confidence</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Priority</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((item) => {
                    // Derive category from record_data_before or merge_preview
                    const category = item.merge_preview ? "dedup" : "cleaning";
                    return (
                      <tr
                        key={item.id}
                        className="border-b border-[#D6E4F0]/50 hover:bg-[#F5F9FF] cursor-pointer"
                        onClick={() => setSelectedId(item.id)}
                      >
                        <td className="px-4 py-3 font-mono text-xs">
                          {item.record_key}
                          {item.golden_record_exists && (
                            <Badge variant="outline" className="ml-2 text-amber-700 border-amber-400 text-xs">
                              Golden record exists
                            </Badge>
                          )}
                        </td>
                        <td className="px-4 py-3">{item.object_type}</td>
                        <td className="px-4 py-3">
                          <Badge variant="outline">{category}</Badge>
                        </td>
                        <td className={`px-4 py-3 text-right font-medium ${confidenceColor(item.confidence)}`}>
                          {item.confidence}%
                        </td>
                        <td className="px-4 py-3">
                          <Badge className={STATUS_COLORS[item.status] ?? STATUS_COLORS.detected}>
                            {item.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-right">{item.priority}</td>
                        <td className="px-4 py-3">
                          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setSelectedId(item.id); }}>
                            View
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                        No cleaning items found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            <ChevronLeft className="h-4 w-4" /> Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
            Next <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Export modal */}
      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Export Cleaning Data</DialogTitle>
            <DialogDescription>
              Export applied cleaning items in SAP-compatible formats.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-3">
              <span className="text-sm font-medium">Format</span>
              {([
                { value: "csv" as const, label: "CSV (SAP field headers)" },
                { value: "lsmw" as const, label: "LSMW Recording" },
                { value: "bapi" as const, label: "BAPI Call JSON" },
                { value: "idoc" as const, label: "IDoc JSON" },
                { value: "sf_csv" as const, label: "SuccessFactors CSV" },
              ]).map((opt) => (
                <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="export-format"
                    value={opt.value}
                    checked={exportFormat === opt.value}
                    onChange={() => setExportFormat(opt.value)}
                    className="accent-[#0695A8]"
                  />
                  <span className="text-sm">{opt.label}</span>
                </label>
              ))}
            </div>

            <div className="space-y-1">
              <span className="text-sm font-medium">Object Type</span>
              <select
                value={objectType}
                onChange={(e) => setObjectType(e.target.value)}
                className="w-full rounded-md border border-border bg-accent px-3 py-1.5 text-sm"
              >
                <option value="">All object types</option>
                <option value="customer">Customer</option>
                <option value="vendor">Vendor</option>
                <option value="material">Material</option>
                <option value="equipment">Equipment</option>
                <option value="employee">Employee</option>
                <option value="financial">Financial</option>
              </select>
            </div>

            <p className="text-sm text-muted-foreground">
              {totalItems} applied items will be exported
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setExportOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={exportLoading}
              onClick={async () => {
                setExportLoading(true);
                try {
                  await downloadCleaningExport(exportFormat, objectType || undefined);
                  toast.success(`Exported as ${exportFormat.toUpperCase()}`);
                  setExportOpen(false);
                } catch {
                  toast.error("Export failed");
                } finally {
                  setExportLoading(false);
                }
              }}
            >
              {exportLoading ? "Exporting..." : "Export"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail drawer */}
      <Sheet open={!!selectedId} onOpenChange={(open) => { if (!open) setSelectedId(null); }}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Cleaning Item Detail</SheetTitle>
            <SheetDescription>
              {detail?.record_key ?? "Loading..."}
            </SheetDescription>
          </SheetHeader>

          {isDetailLoading || !detail ? (
            <div className="space-y-3 p-4">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : (
            <div className="space-y-4 p-4">
              {/* Panel 1: Before/After diff */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Before / After</CardTitle>
                </CardHeader>
                <CardContent>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="py-2 pr-2">Field</th>
                        <th className="py-2 pr-2">Original</th>
                        <th className="py-2">New Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const before = detail.record_data_before ?? {};
                        const after = detail.record_data_after ?? {};
                        const allFields = [...new Set([...Object.keys(before), ...Object.keys(after)])];
                        return allFields
                          .filter((f) => f !== "issue" && f !== "error")
                          .map((field) => {
                            const oldVal = String(before[field] ?? "");
                            const newVal = String(after[field] ?? "");
                            const changed = oldVal !== newVal;
                            return (
                              <tr key={field} className="border-b border-border/30">
                                <td className="py-2 pr-2 font-mono text-xs">{field}</td>
                                <td className={`py-2 pr-2 ${changed ? "text-[#DC2626]" : ""}`}>{oldVal || "—"}</td>
                                <td className={`py-2 ${changed ? "text-[#059669]" : ""}`}>
                                  {newVal || "—"}
                                  {changed && (
                                    <Badge className="ml-2 bg-[#FEF3C7] text-[#D97706] border border-[#FCD34D]">
                                      Modified
                                    </Badge>
                                  )}
                                </td>
                              </tr>
                            );
                          });
                      })()}
                    </tbody>
                  </table>
                </CardContent>
              </Card>

              {/* Golden record value hint */}
              {detail.golden_field_value && (
                <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                  <span className="text-sm font-medium text-muted-foreground">Golden record value:</span>
                  <code className="text-sm bg-muted px-1 rounded">{detail.golden_field_value}</code>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setApproveValue(detail.golden_field_value)}
                  >
                    Use golden value
                  </Button>
                </div>
              )}

              {/* Panel 2: Merge preview (for dedup) */}
              {detail.merge_preview && Object.keys(detail.merge_preview).length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Survivor Builder</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="rounded-lg border p-3">
                        <p className="mb-2 text-xs font-semibold text-muted-foreground">Record A</p>
                        {Object.entries(detail.merge_preview).map(([field, vals]) => (
                          <div key={field} className="flex justify-between border-b border-border/20 py-1 text-xs">
                            <span className="font-mono text-muted-foreground">{field}</span>
                            <span>{(vals as { a: string }).a || "—"}</span>
                          </div>
                        ))}
                      </div>
                      <div className="rounded-lg border p-3">
                        <p className="mb-2 text-xs font-semibold text-muted-foreground">Record B</p>
                        {Object.entries(detail.merge_preview).map(([field, vals]) => (
                          <div key={field} className="flex justify-between border-b border-border/20 py-1 text-xs">
                            <span className="font-mono text-muted-foreground">{field}</span>
                            <span>{(vals as { b: string }).b || "—"}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="mt-3 rounded-lg border border-[#0695A8]/30 bg-[#0695A8]/5 p-3">
                      <p className="mb-2 text-xs font-semibold text-[#0695A8]">Computed Survivor</p>
                      {Object.entries(detail.merge_preview).map(([field, vals]) => (
                        <div key={field} className="flex justify-between border-b border-border/20 py-1 text-xs">
                          <span className="font-mono text-muted-foreground">{field}</span>
                          <span className="font-medium">{(vals as { survivor: string }).survivor || "—"}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Panel 3: Actions */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Actions</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {(detail.status === "detected" || detail.status === "in_review" || detail.status === "recommended") && (
                    <div className="flex gap-2">
                      <Button
                        className="bg-[#0695A8] hover:bg-[#0695A8]/90 text-white"
                        onClick={() => approveMut.mutate(detail.id)}
                        disabled={approveMut.isPending}
                      >
                        Approve
                      </Button>
                      <div className="flex flex-1 gap-2">
                        <input
                          type="text"
                          placeholder="Rejection reason (required)"
                          value={rejectReason}
                          onChange={(e) => setRejectReason(e.target.value)}
                          className="flex-1 rounded-md border px-3 py-1.5 text-sm"
                        />
                        <Button
                          variant="destructive"
                          onClick={() => {
                            if (!rejectReason.trim()) { toast.error("Reason is required"); return; }
                            rejectMut.mutate({ id: detail.id, reason: rejectReason });
                          }}
                          disabled={rejectMut.isPending}
                        >
                          Reject
                        </Button>
                      </div>
                    </div>
                  )}

                  {detail.status === "approved" && (
                    <div className="space-y-2">
                      {approveValue && (
                        <div className="flex items-center gap-2 text-sm">
                          <span className="text-muted-foreground">Override value:</span>
                          <code className="bg-muted px-1 rounded">{approveValue}</code>
                          <Button variant="ghost" size="sm" onClick={() => setApproveValue(null)}>
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      )}
                      <Button
                        className="bg-[#059669] hover:bg-[#059669]/90 text-white"
                        onClick={() => applyMut.mutate(detail.id)}
                        disabled={applyMut.isPending}
                      >
                        Apply Change
                      </Button>
                    </div>
                  )}

                  {detail.status === "applied" && rollbackTimeLeft(detail) && (
                    <div className="flex items-center gap-3">
                      <Button
                        variant="outline"
                        onClick={() => rollbackMut.mutate(detail.id)}
                        disabled={rollbackMut.isPending}
                      >
                        <Undo2 className="mr-1 h-4 w-4" /> Rollback
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        {rollbackTimeLeft(detail)} remaining
                      </span>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Audit trail */}
              {detail.audit && detail.audit.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Audit Trail</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {detail.audit.map((entry) => (
                        <div key={entry.id} className="flex items-start gap-3 text-xs">
                          <Badge variant="outline" className="shrink-0">{entry.action}</Badge>
                          <div className="flex-1">
                            <span className="font-medium">{entry.actor_name}</span>
                            {(() => {
                              const meta = entry.metadata as Record<string, string> | null;
                              return meta?.reason ? (
                                <span className="ml-1 text-muted-foreground">
                                  — {meta.reason}
                                </span>
                              ) : null;
                            })()}
                          </div>
                          <span className="shrink-0 text-muted-foreground">
                            {new Date(entry.created_at).toLocaleString()}
                          </span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
