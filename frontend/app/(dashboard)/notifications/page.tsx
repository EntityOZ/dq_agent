"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  Bell,
  Check,
  CheckCheck,
  ExternalLink,
  Filter,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from "@/lib/api/notifications";
import { relativeTime } from "@/lib/format";
import type { NotificationType } from "@/types/api";

const TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All Types" },
  { value: "finding", label: "Findings" },
  { value: "cleaning", label: "Cleaning" },
  { value: "exception", label: "Exceptions" },
  { value: "approval", label: "Approvals" },
  { value: "digest", label: "Digests" },
  { value: "warning", label: "Warnings" },
];

const READ_OPTIONS = [
  { value: "", label: "All" },
  { value: "false", label: "Unread" },
  { value: "true", label: "Read" },
];

const TYPE_ICONS: Record<string, string> = {
  finding: "🔍",
  cleaning: "✨",
  exception: "🚨",
  approval: "✅",
  digest: "📊",
  warning: "⚠️",
};

const TYPE_COLORS: Record<string, string> = {
  finding: "bg-[#DBEAFE] text-[#1D6ECC]",
  cleaning: "bg-[#D1FAE5] text-[#059669]",
  exception: "bg-[#FEE2E2] text-[#DC2626]",
  approval: "bg-[#D1FAE5] text-[#059669]",
  digest: "bg-[#FEF3C7] text-[#D97706]",
  warning: "bg-[#FEF3C7] text-[#D97706]",
};

export default function NotificationsPage() {
  const router = useRouter();
  const qc = useQueryClient();

  const [typeFilter, setTypeFilter] = useState("");
  const [readFilter, setReadFilter] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const limit = 20;

  const { data, isLoading } = useQuery({
    queryKey: ["notifications-full", typeFilter, readFilter, page],
    queryFn: () =>
      getNotifications({
        type: typeFilter || undefined,
        is_read: readFilter === "" ? undefined : readFilter === "true",
        limit,
        offset: page * limit,
      }),
  });

  const markAllMutation = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications-full"] });
      qc.invalidateQueries({ queryKey: ["notifications-unread-count"] });
    },
  });

  const markReadMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) {
        await markNotificationRead(id);
      }
    },
    onSuccess: () => {
      setSelectedIds(new Set());
      qc.invalidateQueries({ queryKey: ["notifications-full"] });
      qc.invalidateQueries({ queryKey: ["notifications-unread-count"] });
    },
  });

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (!data?.items) return;
    if (selectedIds.size === data.items.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(data.items.map((n) => n.id)));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bell className="h-5 w-5 text-[#0695A8]" />
          <h1 className="text-2xl font-bold text-[#0F2137]">Notifications</h1>
          {data && (
            <Badge variant="secondary" className="ml-2">
              {data.total}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => markReadMutation.mutate([...selectedIds])}
              disabled={markReadMutation.isPending}
            >
              <CheckCheck className="mr-1 h-4 w-4" />
              Mark selected read ({selectedIds.size})
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => markAllMutation.mutate()}
            disabled={markAllMutation.isPending}
          >
            <Check className="mr-1 h-4 w-4" />
            Mark all read
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <Filter className="h-4 w-4 text-[#6B92AD]" />
        <select
          value={typeFilter}
          onChange={(e) => {
            setTypeFilter(e.target.value);
            setPage(0);
          }}
          className="rounded-md border border-[#D6E4F0] bg-white px-3 py-1.5 text-sm text-[#0F2137]"
        >
          {TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <select
          value={readFilter}
          onChange={(e) => {
            setReadFilter(e.target.value);
            setPage(0);
          }}
          className="rounded-md border border-[#D6E4F0] bg-white px-3 py-1.5 text-sm text-[#0F2137]"
        >
          {READ_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* List */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-16" />
              ))}
            </div>
          ) : !data?.items?.length ? (
            <div className="px-4 py-12 text-center text-sm text-[#6B92AD]">
              No notifications found
            </div>
          ) : (
            <>
              {/* Select all header */}
              <div className="flex items-center gap-3 border-b border-[#D6E4F0] px-4 py-2 text-xs text-[#6B92AD]">
                <input
                  type="checkbox"
                  checked={selectedIds.size === data.items.length && data.items.length > 0}
                  onChange={toggleAll}
                  className="h-4 w-4 rounded border-[#D6E4F0] accent-[#0695A8]"
                />
                <span>Select all</span>
              </div>

              {data.items.map((notif) => (
                <div
                  key={notif.id}
                  className={`flex items-start gap-3 border-b border-[#F0F5FA] px-4 py-3 transition-colors hover:bg-[#F0F5FA] ${
                    notif.is_read ? "opacity-60" : ""
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(notif.id)}
                    onChange={() => toggleSelect(notif.id)}
                    className="mt-1 h-4 w-4 rounded border-[#D6E4F0] accent-[#0695A8]"
                  />
                  <span className="mt-0.5 text-base">
                    {TYPE_ICONS[notif.type] || "📋"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-[#0F2137]">
                        {notif.title}
                      </p>
                      <Badge
                        className={`text-[10px] ${TYPE_COLORS[notif.type] || "bg-[#F0F5FA] text-[#6B92AD]"}`}
                      >
                        {notif.type}
                      </Badge>
                      {!notif.is_read && (
                        <span className="h-2 w-2 rounded-full bg-[#0695A8]" />
                      )}
                    </div>
                    <p className="mt-0.5 text-sm text-[#6B92AD]">{notif.body}</p>
                    <p className="mt-1 text-xs text-[#A8C5D8]">
                      {relativeTime(notif.created_at)}
                    </p>
                  </div>
                  {notif.link && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => router.push(notif.link!)}
                      className="shrink-0 text-[#0695A8]"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {data && data.total > limit && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-[#6B92AD]">
            Showing {page * limit + 1}–
            {Math.min((page + 1) * limit, data.total)} of {data.total}
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={(page + 1) * limit >= data.total}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
