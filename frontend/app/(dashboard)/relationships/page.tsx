"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Network, Sparkles, Filter } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { getRelationships, getRelationshipTypes } from "@/lib/api/relationships";
import { formatModuleName, relativeTime } from "@/lib/format";
import type { RecordRelationship, RelationshipTypeRef } from "@/types/api";

function confidenceColor(score: number | null): string {
  if (score == null) return "bg-[#F0F5FA] text-[#6B92AD]";
  if (score >= 0.8) return "bg-[#D1FAE5] text-[#059669]";
  if (score >= 0.5) return "bg-[#FEF3C7] text-[#D97706]";
  return "bg-[#FEE2E2] text-[#DC2626]";
}

function impactBadge(score: number | null): string {
  if (score == null) return "bg-[#F0F5FA] text-[#6B92AD]";
  if (score >= 0.8) return "bg-[#FEE2E2] text-[#DC2626]";
  if (score >= 0.5) return "bg-[#FEF3C7] text-[#D97706]";
  return "bg-[#D1FAE5] text-[#059669]";
}

export default function RelationshipsPage() {
  const [domainFilter, setDomainFilter] = useState<string>("");

  const { data, isLoading } = useQuery({
    queryKey: ["relationships", domainFilter],
    queryFn: () =>
      getRelationships(domainFilter ? { domain: domainFilter } : undefined),
  });

  const { data: types } = useQuery({
    queryKey: ["relationship-types"],
    queryFn: getRelationshipTypes,
  });

  const relationships = data?.relationships ?? [];

  // Build unique domain list from relationship types
  const domains = useMemo(() => {
    if (!types) return [];
    const set = new Set<string>();
    types.forEach((t: RelationshipTypeRef) => {
      set.add(t.from_table);
      set.add(t.to_table);
    });
    return Array.from(set).sort();
  }, [types]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-bold text-[#0F2137]">
            Relationships
          </h1>
          <p className="text-sm text-[#6B92AD]">
            Cross-domain SAP record relationships and dependency graph
          </p>
        </div>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-3">
        <Filter className="h-4 w-4 text-[#6B92AD]" />
        <select
          value={domainFilter}
          onChange={(e) => setDomainFilter(e.target.value)}
          className="rounded-md border border-[#D6E4F0] bg-white px-3 py-1.5 text-sm text-[#0F2137] focus:border-[#0695A8] focus:outline-none focus:ring-1 focus:ring-[#0695A8]"
        >
          <option value="">All domains</option>
          {domains.map((d) => (
            <option key={d} value={d}>
              {formatModuleName(d)}
            </option>
          ))}
        </select>
        {domainFilter && (
          <button
            onClick={() => setDomainFilter("")}
            className="text-xs text-[#0695A8] hover:underline"
          >
            Clear
          </button>
        )}
        <span className="ml-auto text-xs text-[#6B92AD]">
          {data ? `${data.total} relationship${data.total !== 1 ? "s" : ""}` : ""}
        </span>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : relationships.length === 0 ? (
        <Card className="border-[#D6E4F0] bg-white">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Network className="h-12 w-12 text-[#D6E4F0]" />
            <h3 className="mt-4 font-semibold text-[#0F2137]">
              No relationships found
            </h3>
            <p className="mt-1 text-sm text-[#6B92AD]">
              {domainFilter
                ? "No relationships match the selected domain filter."
                : "Relationships are discovered during SAP sync and analysis runs."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#D6E4F0] text-left text-[#6B92AD]">
                    <th className="px-4 py-3">From</th>
                    <th className="px-4 py-3">To</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Confidence</th>
                    <th className="px-4 py-3">Impact</th>
                    <th className="px-4 py-3">Discovered</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {relationships.map((r: RecordRelationship) => (
                    <tr
                      key={r.id}
                      className="border-b border-[#D6E4F0]/50 hover:bg-[#F5F9FF]"
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-[#0F2137]">
                          {formatModuleName(r.from_domain)}
                        </div>
                        <div className="text-xs text-[#6B92AD]">{r.from_key}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-[#0F2137]">
                          {formatModuleName(r.to_domain)}
                        </div>
                        <div className="text-xs text-[#6B92AD]">{r.to_key}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-[#0F2137]">
                          {r.relationship_type.replace(/_/g, " ")}
                        </span>
                        {r.ai_inferred && (
                          <Badge className="ml-2 gap-1 bg-[#E0F4F7] text-[#0695A8] border border-[#B2E0E6]">
                            <Sparkles className="h-3 w-3" />
                            AI
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {r.ai_confidence != null ? (
                          <Badge className={confidenceColor(r.ai_confidence)}>
                            {(r.ai_confidence * 100).toFixed(0)}%
                          </Badge>
                        ) : (
                          <span className="text-xs text-[#6B92AD]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {r.impact_score != null ? (
                          <Badge className={impactBadge(r.impact_score)}>
                            {(r.impact_score * 100).toFixed(0)}%
                          </Badge>
                        ) : (
                          <span className="text-xs text-[#6B92AD]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-[#6B92AD]">
                        {relativeTime(r.discovered_at)}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          className={
                            r.active
                              ? "bg-[#D1FAE5] text-[#059669] border border-[#6EE7B7]"
                              : "bg-[#F0F5FA] text-[#6B92AD] border border-[#D6E4F0]"
                          }
                        >
                          {r.active ? "Active" : "Inactive"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
