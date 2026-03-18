"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Crown,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Send,
  Clock,
  Brain,
  History,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getMasterRecord,
  getMasterRecordHistory,
  promoteMasterRecord,
  writebackMasterRecord,
} from "@/lib/api/master-records";
import { batchLookupGlossary } from "@/lib/api/glossary";
import { formatModuleName, relativeTime } from "@/lib/format";
import type {
  MasterRecordDetail,
  MasterRecordHistoryEntry,
  SourceContribution,
} from "@/types/api";

function ConfidenceBar({
  confidence,
  size = "md",
}: {
  confidence: number;
  size?: "sm" | "md";
}) {
  const pct = Math.round(confidence * 100);
  const color =
    pct >= 85 ? "bg-[#059669]" : pct >= 60 ? "bg-[#D97706]" : "bg-[#DC2626]";
  const height = size === "sm" ? "h-1" : "h-2";
  const width = size === "sm" ? "w-16" : "w-24";
  return (
    <div className="flex items-center gap-2">
      <div className={`${height} ${width} rounded-full bg-[#F0F5FA]`}>
        <div
          className={`${height} rounded-full ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs font-medium text-[#0F2137]">{pct}%</span>
    </div>
  );
}

function FieldRow({
  fieldName,
  goldenValue,
  contribution,
  showAi,
  businessName,
}: {
  fieldName: string;
  goldenValue: unknown;
  contribution: SourceContribution | undefined;
  showAi: boolean;
  businessName?: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasAi = showAi && contribution?.ai_recommendation;

  return (
    <div className="border-b border-[#F0F5FA] last:border-0">
      <div
        className={`flex items-center justify-between px-4 py-3 ${hasAi ? "cursor-pointer hover:bg-[#F0F5FA]/50" : ""}`}
        onClick={() => hasAi && setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          {hasAi && (
            expanded ? (
              <ChevronUp className="h-3.5 w-3.5 text-[#D97706]" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 text-[#D97706]" />
            )
          )}
          <div>
            <span className="text-sm font-medium text-[#0F2137]">
              {businessName || fieldName}
            </span>
            {businessName && (
              <span className="block text-[10px] font-mono text-[#6B92AD]">{fieldName}</span>
            )}
            <p className="text-xs text-[#6B92AD]">
              {contribution
                ? `From ${contribution.source_system} · ${relativeTime(contribution.extracted_at)}`
                : "No source"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className="font-mono text-sm text-[#0F2137]">
            {String(goldenValue ?? "—")}
          </span>
          {contribution && (
            <ConfidenceBar confidence={contribution.confidence} size="sm" />
          )}
          {hasAi && (
            <Badge
              variant="outline"
              className="gap-1 bg-[#D97706]/10 text-[#D97706] border-[#D97706]/20 text-[10px]"
            >
              <Brain className="h-3 w-3" />
              AI
            </Badge>
          )}
        </div>
      </div>

      {/* AI recommendation panel */}
      {expanded && hasAi && contribution && (
        <div className="mx-4 mb-3 rounded-lg border border-[#D97706]/20 bg-[#D97706]/5 p-3">
          <div className="flex items-center gap-2 text-xs font-medium text-[#D97706]">
            <Brain className="h-3.5 w-3.5" />
            AI Recommendation
          </div>
          <div className="mt-2 space-y-1 text-xs text-[#0F2137]">
            <p>
              <span className="text-[#6B92AD]">Recommended source:</span>{" "}
              {contribution.ai_recommendation}
            </p>
            <p>
              <span className="text-[#6B92AD]">AI confidence:</span>{" "}
              {Math.round((contribution.ai_confidence ?? 0) * 100)}%
            </p>
            {contribution.ai_reasoning && (
              <p>
                <span className="text-[#6B92AD]">Reasoning:</span>{" "}
                {contribution.ai_reasoning}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function HistoryPanel({ recordId }: { recordId: string }) {
  const { data: history, isLoading } = useQuery({
    queryKey: ["master-record-history", recordId],
    queryFn: () => getMasterRecordHistory(recordId),
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-[#0695A8]" />
      </div>
    );
  }

  if (!history || history.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-[#6B92AD]">
        No history entries
      </p>
    );
  }

  const changeTypeLabels: Record<string, string> = {
    created: "Record created",
    updated: "Fields updated",
    promoted: "Promoted to golden",
  };

  return (
    <div className="space-y-2">
      {history.map((entry: MasterRecordHistoryEntry) => (
        <div
          key={entry.id}
          className="flex items-start gap-3 rounded-lg border border-[#F0F5FA] px-3 py-2"
        >
          <div className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-[#F0F5FA]">
            {entry.change_type === "promoted" ? (
              <Crown className="h-3 w-3 text-[#059669]" />
            ) : (
              <Clock className="h-3 w-3 text-[#6B92AD]" />
            )}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-[#0F2137]">
                {changeTypeLabels[entry.change_type] ?? entry.change_type}
              </span>
              {entry.ai_was_involved && (
                <Badge
                  variant="outline"
                  className="gap-1 text-[10px] bg-[#D97706]/10 text-[#D97706] border-[#D97706]/20"
                >
                  <Brain className="h-2.5 w-2.5" />
                  AI involved
                </Badge>
              )}
              {entry.ai_recommendation_accepted !== null && (
                <Badge
                  variant="outline"
                  className={`text-[10px] ${
                    entry.ai_recommendation_accepted
                      ? "bg-[#059669]/10 text-[#059669] border-[#059669]/20"
                      : "bg-[#DC2626]/10 text-[#DC2626] border-[#DC2626]/20"
                  }`}
                >
                  AI {entry.ai_recommendation_accepted ? "accepted" : "rejected"}
                </Badge>
              )}
            </div>
            <p className="text-xs text-[#6B92AD]">
              {relativeTime(entry.changed_at)}
              {entry.changed_by && ` · by ${entry.changed_by}`}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function GoldenRecordDetailPage() {
  const params = useParams();
  const router = useRouter();
  const qc = useQueryClient();
  const recordId = params.id as string;
  const [showHistory, setShowHistory] = useState(false);

  const { data: record, isLoading } = useQuery({
    queryKey: ["master-record", recordId],
    queryFn: () => getMasterRecord(recordId),
  });

  // Glossary lookup for field business names
  const fieldKeys = record ? Object.keys(record.golden_fields) : [];
  const { data: glossaryLookup } = useQuery({
    queryKey: ["glossary-lookup", fieldKeys],
    queryFn: () => batchLookupGlossary(fieldKeys),
    enabled: fieldKeys.length > 0,
    staleTime: 5 * 60_000,
  });

  const promoteMutation = useMutation({
    mutationFn: () => promoteMasterRecord(recordId, true),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["master-record", recordId] });
      qc.invalidateQueries({ queryKey: ["master-records"] });
    },
  });

  const writebackMutation = useMutation({
    mutationFn: () => writebackMasterRecord(recordId),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-[#0695A8]" />
      </div>
    );
  }

  if (!record) {
    return (
      <div className="py-20 text-center">
        <p className="text-[#6B92AD]">Record not found</p>
      </div>
    );
  }

  const fieldNames = Object.keys(record.golden_fields);
  const contributions = record.source_contributions as Record<
    string,
    SourceContribution
  >;

  // Check if any field has AI recommendation
  const hasAiFields = Object.values(contributions).some(
    (c) => c && typeof c === "object" && "ai_recommendation" in c
  );

  // Unique source systems
  const sources = new Set<string>();
  Object.values(contributions).forEach((c) => {
    if (c && typeof c === "object" && "source_system" in c) {
      sources.add(c.source_system);
    }
  });

  const statusClasses: Record<string, string> = {
    candidate: "bg-[#0695A8]/10 text-[#0695A8] border-[#0695A8]/20",
    pending_review: "bg-[#D97706]/10 text-[#D97706] border-[#D97706]/20",
    golden: "bg-[#059669]/10 text-[#059669] border-[#059669]/20",
    superseded: "bg-[#6B92AD]/10 text-[#6B92AD] border-[#6B92AD]/20",
  };

  return (
    <div className="space-y-6">
      {/* Back nav */}
      <Link
        href="/golden-records"
        className="inline-flex items-center gap-1 text-sm text-[#6B92AD] hover:text-[#0695A8]"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Golden Records
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-display text-xl font-bold text-[#0F2137]">
              {record.sap_object_key}
            </h1>
            <Badge
              variant="outline"
              className={`gap-1 ${statusClasses[record.status] ?? ""}`}
            >
              {record.status === "golden" && <Crown className="h-3 w-3" />}
              {record.status.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase())}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-[#6B92AD]">
            {formatModuleName(record.domain)} &middot; {sources.size} source
            system{sources.size !== 1 ? "s" : ""}: {Array.from(sources).join(", ")}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {record.status !== "golden" && record.status !== "superseded" && (
            <Button
              onClick={() => promoteMutation.mutate()}
              disabled={promoteMutation.isPending}
              className="gap-2 bg-[#059669] hover:bg-[#047857] text-white"
            >
              {promoteMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Crown className="h-4 w-4" />
              )}
              Promote to Golden
            </Button>
          )}
          {record.status === "golden" && (
            <Button
              onClick={() => writebackMutation.mutate()}
              disabled={writebackMutation.isPending}
              variant="outline"
              className="gap-2 border-[#0695A8] text-[#0695A8] hover:bg-[#0695A8]/5"
            >
              {writebackMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              Write Back to SAP
            </Button>
          )}
        </div>
      </div>

      {/* Confidence overview */}
      <Card className="border-[#D6E4F0] bg-white">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-[#6B92AD]">
                Overall Confidence
              </p>
              <p className="text-3xl font-bold text-[#0F2137]">
                {Math.round(record.overall_confidence * 100)}%
              </p>
            </div>
            <ConfidenceBar confidence={record.overall_confidence} />
          </div>
          {record.promoted_at && (
            <p className="mt-2 text-xs text-[#6B92AD]">
              Promoted {relativeTime(record.promoted_at)}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Writeback success message */}
      {writebackMutation.isSuccess && writebackMutation.data && (
        <Card className="border-[#059669]/20 bg-[#059669]/5">
          <CardContent className="p-4 text-sm text-[#059669]">
            <CheckCircle2 className="mb-1 inline h-4 w-4" />{" "}
            {writebackMutation.data.message}
          </CardContent>
        </Card>
      )}

      {/* Field-level detail */}
      <Card className="border-[#D6E4F0] bg-white">
        <CardContent className="p-0">
          <div className="flex items-center justify-between border-b border-[#F0F5FA] px-4 py-3">
            <h2 className="text-sm font-semibold text-[#0F2137]">
              Field Values ({fieldNames.length})
            </h2>
            {hasAiFields && (
              <div className="flex items-center gap-1 text-xs text-[#D97706]">
                <Brain className="h-3.5 w-3.5" />
                AI recommendations available — click to expand
              </div>
            )}
          </div>
          {fieldNames.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-[#6B92AD]">
              No fields yet
            </p>
          ) : (
            fieldNames.map((field) => (
              <FieldRow
                key={field}
                fieldName={field}
                goldenValue={record.golden_fields[field]}
                contribution={contributions[field]}
                showAi={hasAiFields}
                businessName={glossaryLookup?.lookup?.[field]?.business_name}
              />
            ))
          )}
        </CardContent>
      </Card>

      {/* History toggle */}
      <Card className="border-[#D6E4F0] bg-white">
        <CardContent className="p-0">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-[#F0F5FA]/50"
          >
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-[#6B92AD]" />
              <span className="text-sm font-semibold text-[#0F2137]">
                Audit History
              </span>
            </div>
            {showHistory ? (
              <ChevronUp className="h-4 w-4 text-[#6B92AD]" />
            ) : (
              <ChevronDown className="h-4 w-4 text-[#6B92AD]" />
            )}
          </button>
          {showHistory && (
            <div className="border-t border-[#F0F5FA] px-4 py-3">
              <HistoryPanel recordId={recordId} />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
