"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Crown,
  Filter,
  Loader2,
  ChevronRight,
  Database,
  AlertTriangle,
  CheckCircle2,
  Clock,
  XCircle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { getMasterRecords } from "@/lib/api/master-records";
import { formatModuleName, relativeTime } from "@/lib/format";
import type { MasterRecordSummary, MasterRecordStatus } from "@/types/api";

const STATUS_CONFIG: Record<
  MasterRecordStatus,
  { label: string; icon: React.ReactNode; classes: string }
> = {
  candidate: {
    label: "Candidate",
    icon: <Clock className="h-3.5 w-3.5" />,
    classes: "bg-[#0695A8]/10 text-[#0695A8] border-[#0695A8]/20",
  },
  pending_review: {
    label: "Pending Review",
    icon: <AlertTriangle className="h-3.5 w-3.5" />,
    classes: "bg-[#D97706]/10 text-[#D97706] border-[#D97706]/20",
  },
  golden: {
    label: "Golden",
    icon: <Crown className="h-3.5 w-3.5" />,
    classes: "bg-[#059669]/10 text-[#059669] border-[#059669]/20",
  },
  superseded: {
    label: "Superseded",
    icon: <XCircle className="h-3.5 w-3.5" />,
    classes: "bg-[#6B92AD]/10 text-[#6B92AD] border-[#6B92AD]/20",
  },
};

function ConfidenceBar({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  const color =
    pct >= 85 ? "bg-[#059669]" : pct >= 60 ? "bg-[#D97706]" : "bg-[#DC2626]";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 rounded-full bg-[#F0F5FA]">
        <div
          className={`h-1.5 rounded-full ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs font-medium text-[#0F2137]">{pct}%</span>
    </div>
  );
}

const FALLBACK_STATUS = {
  label: "Unknown",
  icon: <Clock className="h-3.5 w-3.5" />,
  classes: "bg-[#6B92AD]/10 text-[#6B92AD] border-[#6B92AD]/20",
};

function RecordRow({ record }: { record: MasterRecordSummary }) {
  const statusConfig = STATUS_CONFIG[record.status] ?? FALLBACK_STATUS;

  return (
    <Link href={`/golden-records/${record.id}`}>
      <div className="flex items-center justify-between rounded-lg border border-[#D6E4F0] bg-white px-4 py-3 transition-colors hover:border-[#0695A8]/30 hover:bg-[#F0F5FA]/50">
        <div className="flex items-center gap-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#0F2137]/5">
            <Database className="h-4 w-4 text-[#0695A8]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-[#0F2137]">
                {record.sap_object_key}
              </span>
              <Badge
                variant="outline"
                className={`text-[12px] gap-1 ${statusConfig.classes}`}
              >
                {statusConfig.icon}
                {statusConfig.label}
              </Badge>
            </div>
            <p className="text-xs text-[#6B92AD]">
              {formatModuleName(record.domain)} &middot;{" "}
              {record.source_count} source{record.source_count !== 1 ? "s" : ""}{" "}
              &middot; Updated {relativeTime(record.updated_at)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-6">
          {record.pending_issues > 0 && (
            <div className="flex items-center gap-1 text-xs text-[#D97706]">
              <AlertTriangle className="h-3.5 w-3.5" />
              {record.pending_issues} AI conflict{record.pending_issues !== 1 ? "s" : ""}
            </div>
          )}
          <ConfidenceBar confidence={record.overall_confidence} />
          <ChevronRight className="h-4 w-4 text-[#A8C5D8]" />
        </div>
      </div>
    </Link>
  );
}

export default function GoldenRecordsPage() {
  const [domain, setDomain] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ["master-records", domain, status, page],
    queryFn: () =>
      getMasterRecords({
        domain: domain || undefined,
        status: status || undefined,
        page,
        per_page: 20,
      }),
  });

  const records = data?.records ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 20);

  // Stats from current page data
  const goldenCount = records.filter((r) => r.status === "golden").length;
  const pendingCount = records.filter((r) => r.status === "pending_review").length;
  const candidateCount = records.filter((r) => r.status === "candidate").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-bold text-[#0F2137]">
            Golden Records
          </h1>
          <p className="text-sm text-[#6B92AD]">
            Steward-approved authoritative master data records with field-level
            provenance
          </p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="border-[#D6E4F0] bg-white">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#059669]/10">
              <Crown className="h-5 w-5 text-[#059669]" />
            </div>
            <div>
              <p className="text-2xl font-bold text-[#0F2137]">{goldenCount}</p>
              <p className="text-xs text-[#6B92AD]">Golden</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-[#D6E4F0] bg-white">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#D97706]/10">
              <AlertTriangle className="h-5 w-5 text-[#D97706]" />
            </div>
            <div>
              <p className="text-2xl font-bold text-[#0F2137]">{pendingCount}</p>
              <p className="text-xs text-[#6B92AD]">Pending Review</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-[#D6E4F0] bg-white">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#0695A8]/10">
              <CheckCircle2 className="h-5 w-5 text-[#0695A8]" />
            </div>
            <div>
              <p className="text-2xl font-bold text-[#0F2137]">{candidateCount}</p>
              <p className="text-xs text-[#6B92AD]">Candidates</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <Filter className="h-4 w-4 text-[#6B92AD]" />
        <select
          value={domain}
          onChange={(e) => {
            setDomain(e.target.value);
            setPage(1);
          }}
          className="rounded-md border border-[#D6E4F0] bg-white px-3 py-1.5 text-sm text-[#0F2137] focus:border-[#0695A8] focus:outline-none focus:ring-1 focus:ring-[#0695A8]"
        >
          <option value="">All Domains</option>
          <option value="business_partner">Business Partner</option>
          <option value="material_master">Material Master</option>
          <option value="fi_gl">GL Accounts</option>
          <option value="employee_central">Employee Central</option>
        </select>
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className="rounded-md border border-[#D6E4F0] bg-white px-3 py-1.5 text-sm text-[#0F2137] focus:border-[#0695A8] focus:outline-none focus:ring-1 focus:ring-[#0695A8]"
        >
          <option value="">All Statuses</option>
          <option value="candidate">Candidate</option>
          <option value="pending_review">Pending Review</option>
          <option value="golden">Golden</option>
          <option value="superseded">Superseded</option>
        </select>
        <span className="ml-auto text-xs text-[#6B92AD]">
          {total} record{total !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Records list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-[#0695A8]" />
        </div>
      ) : records.length === 0 ? (
        <Card className="border-[#D6E4F0] bg-white">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Database className="h-12 w-12 text-[#D6E4F0]" />
            <h3 className="mt-4 font-semibold text-[#0F2137]">
              No golden records yet
            </h3>
            <p className="mt-1 text-sm text-[#6B92AD]">
              Golden records are created when sync batches are processed through
              the survivorship engine
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {records.map((record) => (
            <RecordRow key={record.id} record={record} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
            className="border-[#D6E4F0] text-[#0F2137]"
          >
            Previous
          </Button>
          <span className="text-sm text-[#6B92AD]">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage(page + 1)}
            className="border-[#D6E4F0] text-[#0F2137]"
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
