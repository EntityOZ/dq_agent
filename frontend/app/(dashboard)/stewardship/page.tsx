"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  ClipboardList,
  Filter,
  Loader2,
  CheckCircle2,
  XCircle,
  ArrowUpRight,
  ChevronRight,
  Zap,
  AlertTriangle,
  Crown,
  FileCheck2,
  BookOpen,
  GitMerge,
  Brain,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getQueueItems,
  resolveItem,
  escalateItem,
  bulkApprove,
  submitAiFeedback,
} from "@/lib/api/stewardship";
import { relativeTime } from "@/lib/format";
import type {
  StewardshipQueueItem,
  StewardshipItemType,
  StewardshipStatus,
} from "@/types/api";

// ── Config ──────────────────────────────────────────────────────────────────

const ITEM_TYPE_CONFIG: Record<
  StewardshipItemType,
  { label: string; icon: React.ReactNode; color: string }
> = {
  merge_decision: {
    label: "Merge Decision",
    icon: <GitMerge className="h-3.5 w-3.5" />,
    color: "bg-[#7C3AED]/10 text-[#7C3AED] border-[#7C3AED]/20",
  },
  golden_record_review: {
    label: "Golden Record",
    icon: <Crown className="h-3.5 w-3.5" />,
    color: "bg-[#D97706]/10 text-[#D97706] border-[#D97706]/20",
  },
  exception: {
    label: "Exception",
    icon: <AlertTriangle className="h-3.5 w-3.5" />,
    color: "bg-[#DC2626]/10 text-[#DC2626] border-[#DC2626]/20",
  },
  writeback_approval: {
    label: "Writeback",
    icon: <FileCheck2 className="h-3.5 w-3.5" />,
    color: "bg-[#0695A8]/10 text-[#0695A8] border-[#0695A8]/20",
  },
  contract_breach: {
    label: "Contract Breach",
    icon: <XCircle className="h-3.5 w-3.5" />,
    color: "bg-[#DC2626]/10 text-[#DC2626] border-[#DC2626]/20",
  },
  glossary_review: {
    label: "Glossary Review",
    icon: <BookOpen className="h-3.5 w-3.5" />,
    color: "bg-[#059669]/10 text-[#059669] border-[#059669]/20",
  },
};

const PRIORITY_LABELS: Record<number, { label: string; color: string }> = {
  1: { label: "Critical", color: "bg-[#DC2626]/10 text-[#DC2626]" },
  2: { label: "High", color: "bg-[#D97706]/10 text-[#D97706]" },
  3: { label: "Medium", color: "bg-[#0695A8]/10 text-[#0695A8]" },
  4: { label: "Low", color: "bg-[#059669]/10 text-[#059669]" },
  5: { label: "Info", color: "bg-[#6B92AD]/10 text-[#6B92AD]" },
};

const STATUS_FILTERS: StewardshipStatus[] = [
  "open",
  "in_progress",
  "resolved",
  "escalated",
];

// ── Confidence Bar ──────────────────────────────────────────────────────────

function ConfidenceBar({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  const color =
    pct >= 85 ? "bg-[#059669]" : pct >= 60 ? "bg-[#D97706]" : "bg-[#DC2626]";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 rounded-full bg-[#F0F5FA]">
        <div
          className={`h-1.5 rounded-full ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs font-medium text-[#0F2137]">{pct}%</span>
    </div>
  );
}

// ── Override Modal ──────────────────────────────────────────────────────────

function OverrideModal({
  open,
  onClose,
  item,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  item: StewardshipQueueItem | null;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Override AI Recommendation</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {item?.ai_recommendation && (
            <div className="rounded-lg bg-[#F0F5FA] p-3">
              <p className="text-xs font-medium text-[#6B92AD]">
                AI Recommendation
              </p>
              <p className="mt-1 text-sm text-[#0F2137]">
                {item.ai_recommendation}
              </p>
            </div>
          )}
          <Textarea
            placeholder="Correction reason (required)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!reason.trim()}
            onClick={() => {
              onSubmit(reason);
              setReason("");
            }}
          >
            Submit Override
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Queue Item Row ──────────────────────────────────────────────────────────

function QueueRow({
  item,
  selected,
  onSelect,
}: {
  item: StewardshipQueueItem;
  selected: boolean;
  onSelect: () => void;
}) {
  const typeConfig = ITEM_TYPE_CONFIG[item.item_type] ?? { label: item.item_type, icon: <ClipboardList className="h-3.5 w-3.5" />, color: "bg-[#6B92AD]/10 text-[#6B92AD] border-[#6B92AD]/20" };
  const priorityConfig = PRIORITY_LABELS[item.priority] ?? PRIORITY_LABELS[3];

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-center gap-3 border-b border-[#F0F5FA] px-4 py-3 text-left transition-colors hover:bg-[#F0F5FA]/50 ${
        selected ? "bg-[#0695A8]/5 border-l-2 border-l-[#0695A8]" : ""
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={`text-[12px] ${typeConfig.color}`}
          >
            {typeConfig.icon}
            <span className="ml-1">{typeConfig.label}</span>
          </Badge>
          <Badge
            variant="outline"
            className={`text-[12px] ${priorityConfig.color}`}
          >
            P{item.priority}
          </Badge>
        </div>
        <p className="mt-1 truncate text-sm font-medium text-[#0F2137]">
          {item.domain}
        </p>
        <div className="mt-0.5 flex items-center gap-2 text-[12px] text-[#6B92AD]">
          <span>{relativeTime(item.created_at)}</span>
          {item.due_at && (
            <span>
              Due {relativeTime(item.due_at)}
            </span>
          )}
        </div>
      </div>
      {item.ai_confidence !== null && item.ai_confidence !== undefined && (
        <div className="shrink-0">
          <ConfidenceBar confidence={item.ai_confidence} />
        </div>
      )}
      <ChevronRight className="h-4 w-4 shrink-0 text-[#6B92AD]" />
    </button>
  );
}

// ── Action Panel ────────────────────────────────────────────────────────────

function ActionPanel({
  item,
  onApprove,
  onReject,
  onEscalate,
  onOverride,
  isResolving,
  userRole,
}: {
  item: StewardshipQueueItem;
  onApprove: () => void;
  onReject: () => void;
  onEscalate: () => void;
  onOverride: () => void;
  isResolving: boolean;
  userRole: string;
}) {
  const typeConfig = ITEM_TYPE_CONFIG[item.item_type] ?? { label: item.item_type, icon: <ClipboardList className="h-3.5 w-3.5" />, color: "bg-[#6B92AD]/10 text-[#6B92AD] border-[#6B92AD]/20" };
  const isAiReviewer = userRole === "ai_reviewer";
  const canApprove = !isAiReviewer && item.status !== "resolved";

  return (
    <div className="space-y-4">
      {/* Item header */}
      <div className="flex items-center gap-2">
        <Badge variant="outline" className={typeConfig.color}>
          {typeConfig.icon}
          <span className="ml-1">{typeConfig.label}</span>
        </Badge>
        <span className="text-sm font-medium text-[#0F2137]">
          {item.domain}
        </span>
      </div>

      {/* Details */}
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-xs text-[#6B92AD]">Priority</p>
          <p className="font-medium text-[#0F2137]">
            P{item.priority} —{" "}
            {PRIORITY_LABELS[item.priority]?.label ?? "Normal"}
          </p>
        </div>
        <div>
          <p className="text-xs text-[#6B92AD]">Status</p>
          <p className="font-medium text-[#0F2137] capitalize">{item.status}</p>
        </div>
        <div>
          <p className="text-xs text-[#6B92AD]">Created</p>
          <p className="font-medium text-[#0F2137]">
            {relativeTime(item.created_at)}
          </p>
        </div>
        {item.sla_hours && (
          <div>
            <p className="text-xs text-[#6B92AD]">SLA</p>
            <p className="font-medium text-[#0F2137]">{item.sla_hours}h</p>
          </div>
        )}
      </div>

      {/* AI Recommendation panel */}
      {item.ai_recommendation && (
        <div className="rounded-lg border border-[#D6E4F0] bg-[#F0F5FA] p-3">
          <div className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-[#7C3AED]" />
            <span className="text-xs font-semibold text-[#0F2137]">
              AI Recommendation
            </span>
          </div>
          {item.ai_confidence !== null && item.ai_confidence !== undefined && (
            <div className="mt-2">
              <ConfidenceBar confidence={item.ai_confidence} />
            </div>
          )}
          <p className="mt-2 text-sm text-[#0F2137]">
            {item.ai_recommendation}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2 text-xs"
            onClick={onOverride}
          >
            Override
          </Button>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2 pt-2 border-t border-[#D6E4F0]">
        {canApprove ? (
          <>
            <Button
              size="sm"
              className="flex-1 bg-[#059669] hover:bg-[#059669]/90"
              onClick={onApprove}
              disabled={isResolving}
            >
              {isResolving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
              )}
              Approve (A)
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="flex-1 text-[#DC2626] border-[#DC2626]/30 hover:bg-[#DC2626]/5"
              onClick={onReject}
              disabled={isResolving}
            >
              <XCircle className="mr-1 h-3.5 w-3.5" />
              Reject (R)
            </Button>
          </>
        ) : isAiReviewer ? (
          <div className="w-full rounded-lg bg-[#6B92AD]/10 px-3 py-2 text-center text-xs text-[#6B92AD]">
            AI Reviewer role cannot approve data actions. Contact a Steward or
            Admin.
          </div>
        ) : null}
        <Button
          size="sm"
          variant="outline"
          onClick={onEscalate}
          disabled={isResolving || item.status === "resolved"}
        >
          <ArrowUpRight className="mr-1 h-3.5 w-3.5" />
          Escalate (E)
        </Button>
      </div>
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────────────────────

export default function StewardshipWorkbench() {
  const qc = useQueryClient();
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] =
    useState<StewardshipStatus>("open");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkIds, setBulkIds] = useState<Set<string>>(new Set());

  // Simulated user role — in production read from auth context
  const userRole =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("role") ?? "steward"
      : "steward";

  const { data, isLoading } = useQuery({
    queryKey: ["stewardship-queue", typeFilter, statusFilter],
    queryFn: () =>
      getQueueItems({
        item_type: typeFilter || undefined,
        status: statusFilter,
        limit: 100,
      }),
    refetchInterval: 15_000,
  });

  const items = data?.items ?? [];
  const selectedItem = items.find((i) => i.id === selectedId) ?? null;

  const resolveMutation = useMutation({
    mutationFn: ({
      id,
      action,
    }: {
      id: string;
      action: "approve" | "reject";
    }) => resolveItem(id, action),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["stewardship-queue"] });
      // Move to next item
      const idx = items.findIndex((i) => i.id === selectedId);
      if (idx >= 0 && idx < items.length - 1) {
        setSelectedId(items[idx + 1].id);
      } else {
        setSelectedId(null);
      }
    },
  });

  const escalateMutation = useMutation({
    mutationFn: (id: string) => escalateItem(id),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["stewardship-queue"] }),
  });

  const bulkApproveMutation = useMutation({
    mutationFn: (ids: string[]) => bulkApprove(ids, 0.85),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["stewardship-queue"] });
      setBulkIds(new Set());
      setBulkMode(false);
    },
  });

  const feedbackMutation = useMutation({
    mutationFn: (body: {
      queue_item_id: string;
      steward_decision: string;
      correction_reason: string;
      domain: string;
    }) => submitAiFeedback(body),
    onSuccess: () => setOverrideOpen(false),
  });

  // Keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
      if (!selectedItem || selectedItem.status === "resolved") return;

      if (e.key === "a" || e.key === "A") {
        e.preventDefault();
        if (userRole !== "ai_reviewer") {
          resolveMutation.mutate({ id: selectedItem.id, action: "approve" });
        }
      } else if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        if (userRole !== "ai_reviewer") {
          resolveMutation.mutate({ id: selectedItem.id, action: "reject" });
        }
      } else if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        const idx = items.findIndex((i) => i.id === selectedId);
        if (idx >= 0 && idx < items.length - 1) {
          setSelectedId(items[idx + 1].id);
        }
      } else if (e.key === "e" || e.key === "E") {
        e.preventDefault();
        escalateMutation.mutate(selectedItem.id);
      }
    },
    [selectedItem, selectedId, items, resolveMutation, escalateMutation, userRole]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0695A8]/10">
            <ClipboardList className="h-5 w-5 text-[#0695A8]" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-[#0F2137]">
              Stewardship Workbench
            </h1>
            <p className="text-sm text-[#6B92AD]">
              {data?.total ?? 0} items in queue
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/stewardship/metrics">
            <Button variant="outline" size="sm">
              Metrics
            </Button>
          </Link>
          {userRole !== "ai_reviewer" && (
            <Button
              variant={bulkMode ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setBulkMode(!bulkMode);
                setBulkIds(new Set());
              }}
            >
              <Zap className="mr-1 h-3.5 w-3.5" />
              {bulkMode ? "Cancel Bulk" : "Bulk Approve"}
            </Button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2">
        <Filter className="h-4 w-4 text-[#6B92AD]" />
        {/* Status */}
        {STATUS_FILTERS.map((s) => (
          <Button
            key={s}
            variant={statusFilter === s ? "default" : "outline"}
            size="sm"
            className="text-xs capitalize"
            onClick={() => setStatusFilter(s)}
          >
            {s.replace("_", " ")}
          </Button>
        ))}
        <span className="mx-1 h-4 w-px bg-[#D6E4F0]" />
        {/* Type */}
        <Button
          variant={!typeFilter ? "default" : "outline"}
          size="sm"
          className="text-xs"
          onClick={() => setTypeFilter("")}
        >
          All Types
        </Button>
        {Object.entries(ITEM_TYPE_CONFIG).map(([key, cfg]) => (
          <Button
            key={key}
            variant={typeFilter === key ? "default" : "outline"}
            size="sm"
            className="text-xs"
            onClick={() => setTypeFilter(key)}
          >
            {cfg.label}
          </Button>
        ))}
      </div>

      {/* Bulk approve bar */}
      {bulkMode && (
        <div className="flex items-center gap-3 rounded-lg border border-[#0695A8]/30 bg-[#0695A8]/5 px-4 py-2">
          <span className="text-sm text-[#0F2137]">
            {bulkIds.size} selected (confidence &ge; 85%)
          </span>
          <Button
            size="sm"
            disabled={bulkIds.size === 0 || bulkApproveMutation.isPending}
            onClick={() => bulkApproveMutation.mutate(Array.from(bulkIds))}
          >
            {bulkApproveMutation.isPending ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : null}
            Approve {bulkIds.size}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              // Select all with high confidence
              const highConf = items.filter(
                (i) =>
                  i.ai_confidence !== null &&
                  i.ai_confidence >= 0.85 &&
                  i.status !== "resolved"
              );
              setBulkIds(new Set(highConf.map((i) => i.id)));
            }}
          >
            Select all high confidence
          </Button>
        </div>
      )}

      {/* Split panel */}
      <div className="flex gap-4" style={{ minHeight: "calc(100vh - 280px)" }}>
        {/* Left: queue list */}
        <Card className="w-[420px] shrink-0 overflow-hidden">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex h-40 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-[#0695A8]" />
              </div>
            ) : items.length === 0 ? (
              <div className="flex h-40 items-center justify-center text-sm text-[#6B92AD]">
                No items in queue
              </div>
            ) : (
              <div className="max-h-[calc(100vh-300px)] overflow-y-auto">
                {items.map((item) => (
                  <div key={item.id} className="flex items-center">
                    {bulkMode && (
                      <input
                        type="checkbox"
                        className="ml-3 h-4 w-4 rounded border-[#D6E4F0]"
                        checked={bulkIds.has(item.id)}
                        onChange={(e) => {
                          const next = new Set(bulkIds);
                          if (e.target.checked) next.add(item.id);
                          else next.delete(item.id);
                          setBulkIds(next);
                        }}
                      />
                    )}
                    <div className="flex-1">
                      <QueueRow
                        item={item}
                        selected={item.id === selectedId}
                        onSelect={() => setSelectedId(item.id)}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right: action panel */}
        <Card className="flex-1">
          <CardContent className="p-5">
            {selectedItem ? (
              <ActionPanel
                item={selectedItem}
                onApprove={() =>
                  resolveMutation.mutate({
                    id: selectedItem.id,
                    action: "approve",
                  })
                }
                onReject={() =>
                  resolveMutation.mutate({
                    id: selectedItem.id,
                    action: "reject",
                  })
                }
                onEscalate={() => escalateMutation.mutate(selectedItem.id)}
                onOverride={() => setOverrideOpen(true)}
                isResolving={resolveMutation.isPending}
                userRole={userRole}
              />
            ) : (
              <div className="flex h-60 items-center justify-center text-sm text-[#6B92AD]">
                Select an item from the queue
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Override modal */}
      <OverrideModal
        open={overrideOpen}
        onClose={() => setOverrideOpen(false)}
        item={selectedItem}
        onSubmit={(reason) => {
          if (selectedItem) {
            feedbackMutation.mutate({
              queue_item_id: selectedItem.id,
              steward_decision: "override",
              correction_reason: reason,
              domain: selectedItem.domain,
            });
          }
        }}
      />

      {/* Keyboard shortcut hint */}
      <div className="flex items-center gap-4 text-[12px] text-[#A8C5D8]">
        <span>
          <kbd className="rounded border border-[#D6E4F0] px-1.5 py-0.5 font-mono">
            A
          </kbd>{" "}
          Approve
        </span>
        <span>
          <kbd className="rounded border border-[#D6E4F0] px-1.5 py-0.5 font-mono">
            R
          </kbd>{" "}
          Reject
        </span>
        <span>
          <kbd className="rounded border border-[#D6E4F0] px-1.5 py-0.5 font-mono">
            N
          </kbd>{" "}
          Next
        </span>
        <span>
          <kbd className="rounded border border-[#D6E4F0] px-1.5 py-0.5 font-mono">
            E
          </kbd>{" "}
          Escalate
        </span>
      </div>
    </div>
  );
}
