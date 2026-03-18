"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { useState } from "react";
import { User, Bell } from "lucide-react";

const isLocalAuth = process.env.NEXT_PUBLIC_AUTH_MODE === "local";

const ClerkUserButton = dynamic(
  () => import("@clerk/nextjs").then((mod) => mod.UserButton),
  {
    ssr: false,
    loading: () => <User className="h-5 w-5 text-[#6B92AD]" />,
  }
);

function LocalUserButton() {
  return (
    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#0695A8] text-xs font-medium text-white">
      DU
    </div>
  );
}

const UserButton = isLocalAuth ? LocalUserButton : ClerkUserButton;
import {
  LayoutDashboard,
  Upload,
  AlertTriangle,
  GitCompareArrows,
  FileText,
  Settings,
  ShieldCheck,
  GitMerge,
  ShieldAlert,
  BarChart3,
  MessageSquareText,
  FileCheck2,
  Server,
  RefreshCw,
  BookOpen,
  ClipboardList,
  Database,
  Network,
  Eraser,
  BrainCircuit,
  type LucideIcon,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import apiClient from "@/lib/api/client";
import {
  getNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
} from "@/lib/api/notifications";
import { relativeTime } from "@/lib/format";
import type { HealthResponse, Notification as NotifType } from "@/types/api";

const NOTIF_TYPE_ICONS: Record<string, string> = {
  finding: "🔍",
  cleaning: "✨",
  exception: "🚨",
  approval: "✅",
  digest: "📊",
  warning: "⚠️",
};

function NotificationBell() {
  const router = useRouter();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: unreadCount = 0 } = useQuery({
    queryKey: ["notifications-unread-count"],
    queryFn: getUnreadCount,
    refetchInterval: 30_000,
  });

  const { data: recent } = useQuery({
    queryKey: ["notifications-recent"],
    queryFn: () => getNotifications({ limit: 10 }),
    enabled: open,
  });

  const markAllMutation = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications-unread-count"] });
      qc.invalidateQueries({ queryKey: ["notifications-recent"] });
    },
  });

  const handleClick = async (notif: NotifType) => {
    if (!notif.is_read) {
      await markNotificationRead(notif.id);
      qc.invalidateQueries({ queryKey: ["notifications-unread-count"] });
      qc.invalidateQueries({ queryKey: ["notifications-recent"] });
    }
    if (notif.link) {
      setOpen(false);
      router.push(notif.link);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger>
        <button
          type="button"
          title="Notifications"
          aria-label="Notifications"
          className="relative flex h-8 w-8 items-center justify-center rounded-lg text-[#6B92AD] hover:bg-[#F0F5FA] hover:text-[#0F2137] transition-colors"
        >
          <Bell className="h-[18px] w-[18px]" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#DC2626] px-1 text-[10px] font-bold text-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0" sideOffset={8}>
        <div className="flex items-center justify-between border-b border-[#D6E4F0] px-3 py-2">
          <span className="text-sm font-semibold text-[#0F2137]">Notifications</span>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={() => markAllMutation.mutate()}
              className="text-xs text-[#0695A8] hover:underline"
            >
              Mark all read
            </button>
          )}
        </div>
        <div className="max-h-80 overflow-y-auto">
          {(!recent?.items || recent.items.length === 0) ? (
            <div className="px-3 py-6 text-center text-sm text-[#6B92AD]">
              No notifications
            </div>
          ) : (
            recent.items.map((notif) => (
              <button
                key={notif.id}
                type="button"
                onClick={() => handleClick(notif)}
                className={`flex w-full gap-2 border-b border-[#F0F5FA] px-3 py-2 text-left transition-colors hover:bg-[#F0F5FA] ${
                  notif.is_read ? "opacity-60" : ""
                }`}
              >
                <span className="mt-0.5 text-sm">{NOTIF_TYPE_ICONS[notif.type] || "📋"}</span>
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-medium text-[#0F2137]">{notif.title}</p>
                  <p className="truncate text-xs text-[#6B92AD]">
                    {notif.body.length > 60 ? notif.body.slice(0, 60) + "…" : notif.body}
                  </p>
                  <p className="mt-0.5 text-[10px] text-[#A8C5D8]">{relativeTime(notif.created_at)}</p>
                </div>
                {!notif.is_read && (
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#0695A8]" />
                )}
              </button>
            ))
          )}
        </div>
        <div className="border-t border-[#D6E4F0] px-3 py-2">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              router.push("/notifications");
            }}
            className="w-full text-center text-xs font-medium text-[#0695A8] hover:underline"
          >
            View all
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  permission?: string;
}

interface NavGroup {
  group: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    group: "Connect",
    items: [
      { href: "/systems", label: "Systems", icon: Server },
      { href: "/sync", label: "Sync Monitor", icon: RefreshCw },
      { href: "/upload", label: "Import", icon: Upload },
    ],
  },
  {
    group: "Govern",
    items: [
      { href: "/golden-records", label: "Golden Records", icon: Database },
      { href: "/glossary", label: "Glossary", icon: BookOpen },
      { href: "/contracts", label: "Contracts", icon: FileCheck2 },
      { href: "/relationships", label: "Relationships", icon: Network },
    ],
  },
  {
    group: "Steward",
    items: [
      { href: "/stewardship", label: "Workbench", icon: ClipboardList },
      { href: "/ai/rules", label: "AI Rules", icon: BrainCircuit, permission: "review_ai_rules" },
      { href: "/exceptions", label: "Exceptions", icon: ShieldAlert },
      { href: "/cleaning", label: "Cleaning", icon: Eraser },
      { href: "/dedup", label: "Dedup", icon: GitMerge },
    ],
  },
  {
    group: "Analyse",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
      { href: "/findings", label: "Findings", icon: AlertTriangle },
      { href: "/analytics", label: "Analytics", icon: BarChart3 },
      { href: "/nlp", label: "Ask AI", icon: MessageSquareText },
    ],
  },
  {
    group: "Report",
    items: [
      { href: "/reports", label: "Reports", icon: FileText },
      { href: "/versions", label: "Versions", icon: GitCompareArrows },
    ],
  },
];

const ROLES_WITH_AI_RULES = ["admin", "steward", "ai_reviewer"];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { data: health } = useQuery<HealthResponse>({
    queryKey: ["health"],
    queryFn: async () => (await apiClient.get("/health")).data,
    staleTime: 60_000,
  });

  const licence = health?.licence;
  const licenceDotColor =
    licence?.valid === true
      ? "bg-[#059669]"
      : licence?.valid === false
        ? "bg-[#DC2626]"
        : "bg-[#6B92AD]";
  const licencePulse = licence?.valid === true ? "animate-[vx-pulse-dot_2s_ease-in-out_infinite]" : "";

  const timestamp = health?.timestamp
    ? new Date(health.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "";

  // Simulated user role — in production this comes from auth context
  const userRole = (typeof window !== "undefined" && localStorage.getItem("vx_demo_role")) || "admin";

  return (
    <div className="flex h-screen overflow-hidden bg-[#F0F5FA]">
      {/* Sidebar — grouped, labelled, 200px, deep navy */}
      <aside className="relative z-50 flex w-[200px] shrink-0 flex-col border-r border-white/10 bg-[#0F2137]">
        {/* Logo */}
        <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-white/10 px-4">
          <ShieldCheck className="h-5 w-5 text-[#0695A8]" />
          <span className="font-display text-sm font-bold text-white">Vantax</span>
          <span className="font-display text-sm font-bold text-[#0695A8]">MDM</span>
        </div>

        {/* Nav groups */}
        <ScrollArea className="flex-1 px-2 py-3">
          <nav className="flex flex-col gap-4">
            {NAV_GROUPS.map(({ group, items }) => {
              const visibleItems = items.filter((item) => {
                if (item.permission === "review_ai_rules") {
                  return ROLES_WITH_AI_RULES.includes(userRole);
                }
                return true;
              });
              if (visibleItems.length === 0) return null;

              return (
                <div key={group}>
                  <span className="mb-1 block px-2 text-[10px] font-semibold uppercase tracking-wider text-[#6B92AD]">
                    {group}
                  </span>
                  <div className="flex flex-col gap-0.5">
                    {visibleItems.map(({ href, label, icon: Icon }) => {
                      const active =
                        href === "/" ? pathname === "/" : pathname.startsWith(href);
                      return (
                        <Link
                          key={href}
                          href={href}
                          className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] transition-colors ${
                            active
                              ? "bg-white/10 text-white font-medium border-l-2 border-l-[#0695A8]"
                              : "text-[#A8C5D8] hover:bg-white/5 hover:text-white"
                          }`}
                        >
                          <Icon className="h-4 w-4 shrink-0" />
                          {label}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {/* Settings — standalone at bottom of nav */}
            <div>
              <Link
                href="/settings"
                className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] transition-colors ${
                  pathname.startsWith("/settings")
                    ? "bg-white/10 text-white font-medium border-l-2 border-l-[#0695A8]"
                    : "text-[#A8C5D8] hover:bg-white/5 hover:text-white"
                }`}
              >
                <Settings className="h-4 w-4 shrink-0" />
                Settings
              </Link>
            </div>
          </nav>
        </ScrollArea>

        {/* Bottom — licence dot */}
        <div className="flex items-center gap-2 border-t border-white/10 px-4 py-3">
          <div className={`h-2 w-2 rounded-full ${licenceDotColor} ${licencePulse}`} />
          <span className="text-[11px] text-[#6B92AD]">
            {licence?.valid === true ? "Licensed" : licence?.valid === false ? "Unlicensed" : "Checking..."}
          </span>
        </div>
      </aside>

      {/* Main area */}
      <div className="relative z-0 flex flex-1 flex-col overflow-hidden">
        {/* Top bar — white, 52px */}
        <header className="flex h-[52px] shrink-0 items-center justify-between border-b border-[#D6E4F0] bg-white px-5">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-[#0695A8]" />
            <span className="font-display text-base font-bold text-[#0F2137]">
              Vantax
            </span>
            <span className="font-display text-base font-bold text-[#0695A8]">
              DQ
            </span>
          </div>
          <div className="flex items-center gap-4">
            {timestamp && (
              <span className="font-mono text-xs text-[#6B92AD]">
                Updated: {timestamp}
              </span>
            )}
            <NotificationBell />
            <UserButton />
          </div>
        </header>

        {/* Content */}
        <ScrollArea className="flex-1 overflow-hidden">
          <main className="p-6">{children}</main>
        </ScrollArea>
      </div>
    </div>
  );
}

