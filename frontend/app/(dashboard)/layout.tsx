"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { useState, useEffect, useCallback } from "react";
import { User, Bell, Menu, X, ChevronLeft, ChevronRight, Search, Download } from "lucide-react";

const isLocalAuth = process.env.NEXT_PUBLIC_AUTH_MODE === "local";

const ClerkUserButton = dynamic(
  () => import("@clerk/nextjs").then((mod) => mod.UserButton),
  {
    ssr: false,
    loading: () => <User className="h-5 w-5 text-[#6B8299]" />,
  }
);

function LocalUserButton() {
  return (
    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#0695A8] text-xs font-semibold text-white">
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
import "@/app/sidebar-responsive.css";
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

/* ─── Page title mapping ─── */
const PAGE_TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/systems": "SAP Systems",
  "/sync": "Sync Monitor",
  "/upload": "Import Data",
  "/golden-records": "Golden Records",
  "/glossary": "Business Glossary",
  "/contracts": "Data Contracts",
  "/relationships": "Relationships",
  "/stewardship": "Stewardship",
  "/ai/rules": "AI Rules",
  "/exceptions": "Exceptions",
  "/cleaning": "Cleaning Queue",
  "/dedup": "Deduplication",
  "/match-rules": "Match Rules",
  "/findings": "Findings",
  "/analytics": "Analytics",
  "/nlp": "Ask Vantax",
  "/reports": "Reports",
  "/versions": "Versions",
  "/settings": "Settings",
  "/notifications": "Notifications",
  "/users": "User Management",
};

function getPageTitle(pathname: string): string {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
  for (const [path, title] of Object.entries(PAGE_TITLES)) {
    if (pathname.startsWith(path + "/")) return title;
  }
  return "Vantax";
}

/* ─── Notification bell ─── */
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
      <PopoverTrigger
        render={
          <button
            type="button"
            title="Notifications"
            aria-label="Notifications"
            className="relative flex h-9 w-9 items-center justify-center rounded-xl text-[#6B8299] transition-all hover:bg-[#EAF0F6] hover:text-[#1B2A4A]"
          />
        }
      >
        <Bell className="h-[18px] w-[18px]" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#DC2626] px-1 text-[11px] font-bold text-white ring-2 ring-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 overflow-hidden rounded-2xl border-[#D0DBE5] p-0 shadow-xl" sideOffset={8}>
        <div className="flex items-center justify-between border-b border-[#EAF0F6] px-4 py-3">
          <span className="font-display text-sm font-semibold text-[#1B2A4A]">Notifications</span>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={() => markAllMutation.mutate()}
              className="text-xs font-medium text-[#0695A8] hover:text-[#057A8A] transition-colors"
            >
              Mark all read
            </button>
          )}
        </div>
        <div className="max-h-80 overflow-y-auto">
          {(!recent?.items || recent.items.length === 0) ? (
            <div className="px-4 py-8 text-center text-sm text-[#6B8299]">
              No notifications yet
            </div>
          ) : (
            recent.items.map((notif) => (
              <button
                key={notif.id}
                type="button"
                onClick={() => handleClick(notif)}
                className={`flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-[#F3F7FB] ${
                  notif.is_read ? "opacity-50" : ""
                }`}
              >
                <span className="mt-0.5 text-sm">{NOTIF_TYPE_ICONS[notif.type] || "📋"}</span>
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-medium text-[#1B2A4A]">{notif.title}</p>
                  <p className="truncate text-xs text-[#6B8299] mt-0.5">
                    {notif.body.length > 60 ? notif.body.slice(0, 60) + "…" : notif.body}
                  </p>
                  <p className="mt-1 text-[12px] text-[#6B8299]">{relativeTime(notif.created_at)}</p>
                </div>
                {!notif.is_read && (
                  <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-[#0695A8]" />
                )}
              </button>
            ))
          )}
        </div>
        <div className="border-t border-[#EAF0F6] px-4 py-2.5">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              router.push("/notifications");
            }}
            className="w-full text-center text-xs font-medium text-[#0695A8] hover:text-[#057A8A] transition-colors"
          >
            View all notifications
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* ─── Nav config ─── */
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
    group: "Connect",
    items: [
      { href: "/systems", label: "Systems", icon: Server },
      { href: "/sync", label: "Sync Monitor", icon: RefreshCw },
      { href: "/upload", label: "Import", icon: Upload },
    ],
  },
];

const ROLES_WITH_AI_RULES = ["admin", "steward", "ai_reviewer"];

/*
 * Sidebar content — uses data-* attributes for CSS-driven responsive collapse.
 * Between lg (1024px) and xl (1280px), globals.css hides labels and collapses
 * the sidebar to 72px via aside[data-sidebar] selectors.
 * When user manually collapses, JS `collapsed` prop hides labels directly.
 */
function SidebarNav({
  collapsed,
  pathname,
  userRole,
  onNavClick,
}: {
  collapsed: boolean;
  pathname: string;
  userRole: string;
  onNavClick?: () => void;
}) {
  return (
    <nav className="flex flex-col gap-5">
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
            {!collapsed && (
              <span data-sidebar-label className="mb-1.5 block px-3 text-[12px] font-semibold uppercase tracking-[0.14em] text-[#6B8299]">
                {group}
              </span>
            )}
            {collapsed && (
              <div className="mb-1 mx-auto w-6 border-t border-[#D0DBE5]" />
            )}
            {!collapsed && (
              <div data-sidebar-divider className="hidden mb-1 mx-auto w-6 border-t border-[#D0DBE5]" />
            )}
            <div className="flex flex-col gap-0.5">
              {visibleItems.map(({ href, label, icon: Icon }) => {
                const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    data-sidebar-link
                    title={label}
                    onClick={onNavClick}
                    className={`group relative flex items-center gap-3 rounded-xl transition-all duration-150 ${
                      collapsed
                        ? "mx-auto h-10 w-10 justify-center"
                        : "mx-1 px-3 py-2"
                    } ${
                      active
                        ? "bg-[#0695A8] text-white shadow-md shadow-[#0695A8]/20"
                        : "text-[#3D5068] hover:bg-[#EAF0F6] hover:text-[#1B2A4A]"
                    }`}
                  >
                    <Icon data-sidebar-icon className={`shrink-0 ${collapsed ? "h-5 w-5" : "h-[18px] w-[18px]"}`} />
                    {!collapsed && (
                      <span data-sidebar-label className="text-[16px] font-medium truncate">{label}</span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Settings — standalone */}
      <div>
        {collapsed && <div className="mb-1 mx-auto w-6 border-t border-[#D0DBE5]" />}
        {!collapsed && <div data-sidebar-divider className="hidden mb-1 mx-auto w-6 border-t border-[#D0DBE5]" />}
        <Link
          href="/settings"
          data-sidebar-link
          title="Settings"
          onClick={onNavClick}
          className={`group relative flex items-center gap-3 rounded-xl transition-all duration-150 ${
            collapsed
              ? "mx-auto h-10 w-10 justify-center"
              : "mx-1 px-3 py-2"
          } ${
            pathname.startsWith("/settings")
              ? "bg-[#0695A8] text-white shadow-md shadow-[#0695A8]/20"
              : "text-[#3D5068] hover:bg-[#EAF0F6] hover:text-[#1B2A4A]"
          }`}
        >
          <Settings data-sidebar-icon className={`shrink-0 ${collapsed ? "h-5 w-5" : "h-[18px] w-[18px]"}`} />
          {!collapsed && <span data-sidebar-label className="text-[16px] font-medium">Settings</span>}
        </Link>
      </div>
    </nav>
  );
}

/* ─── Main layout ─── */
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // Persist sidebar collapse preference
  useEffect(() => {
    const saved = localStorage.getItem("vx_sidebar_collapsed");
    if (saved === "true") setCollapsed(true);
  }, []);

  const toggleCollapse = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("vx_sidebar_collapsed", String(next));
      return next;
    });
  }, []);

  // Close mobile sidebar on escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && sidebarOpen) setSidebarOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [sidebarOpen]);

  // Close mobile sidebar on route change
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  const { data: health } = useQuery<HealthResponse>({
    queryKey: ["health"],
    queryFn: async () => (await apiClient.get("/health")).data,
    staleTime: 60_000,
  });

  const licence = health?.licence;
  const licenceDotColor =
    licence?.valid === true
      ? "bg-[#10B981]"
      : licence?.valid === false
        ? "bg-[#DC2626]"
        : "bg-[#6B8299]";
  const licencePulse = licence?.valid === true ? "animate-[vx-pulse-dot_2s_ease-in-out_infinite]" : "";

  const userRole = (typeof window !== "undefined" && localStorage.getItem("vx_demo_role")) || "admin";
  const pageTitle = getPageTitle(pathname);

  return (
    <div className="flex h-screen overflow-hidden bg-[#EAF0F6]">
      {/* ── Mobile backdrop ── */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ── Sidebar ── */}
      <aside
        data-sidebar
        className={`fixed inset-y-0 left-0 z-50 flex flex-col bg-white border-r border-[#D0DBE5] transition-all duration-300 ease-in-out lg:relative lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        } ${
          collapsed ? "lg:w-[72px]" : "lg:w-[260px]"
        } w-[280px]`}
      >
        {/* Logo */}
        <div data-sidebar-header className={`flex h-16 shrink-0 items-center border-b border-[#D0DBE5] ${collapsed ? "justify-center px-2" : "justify-between px-5"}`}>
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#0695A8] shadow-lg shadow-[#0695A8]/25">
              <ShieldCheck className="h-4.5 w-4.5 text-white" />
            </div>
            {!collapsed && (
              <div data-sidebar-label className="flex items-baseline gap-1">
                <span className="font-display text-[17px] font-bold text-[#1B2A4A]">Vantax</span>
                <span className="font-display text-[17px] font-bold text-[#0695A8]">MDM</span>
              </div>
            )}
          </Link>

          {/* Close button — mobile only */}
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[#6B8299] hover:bg-[#EAF0F6] hover:text-[#1B2A4A] transition-colors lg:hidden"
            aria-label="Close sidebar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Nav */}
        <ScrollArea className="flex-1 py-4 px-2 vx-sidebar-scroll">
          <SidebarNav
            collapsed={collapsed}
            pathname={pathname}
            userRole={userRole}
            onNavClick={() => setSidebarOpen(false)}
          />
        </ScrollArea>

        {/* Footer — licence + collapse toggle */}
        <div data-sidebar-footer className={`flex items-center border-t border-[#D0DBE5] ${collapsed ? "flex-col gap-3 px-2 py-3" : "justify-between px-5 py-3"}`}>
          <div className="flex items-center gap-2">
            <div className={`h-2 w-2 rounded-full ${licenceDotColor} ${licencePulse}`} />
            {!collapsed && (
              <span data-sidebar-label className="text-[13px] text-[#6B8299]">
                {licence?.valid === true ? "Licensed" : licence?.valid === false ? "Unlicensed" : "Checking…"}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={toggleCollapse}
            className="hidden lg:flex h-7 w-7 items-center justify-center rounded-lg text-[#6B8299] hover:bg-[#EAF0F6] hover:text-[#1B2A4A] transition-colors"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>
      </aside>

      {/* ── Main area ── */}
      <div className="relative z-0 flex flex-1 flex-col min-w-0">
        {/* Header */}
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-[#D0DBE5] bg-white px-4 sm:px-6">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {/* Mobile hamburger */}
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="flex h-9 w-9 items-center justify-center rounded-xl text-[#6B8299] hover:bg-[#EAF0F6] hover:text-[#1B2A4A] transition-colors lg:hidden"
              aria-label="Open navigation"
            >
              <Menu className="h-5 w-5" />
            </button>

            {/* Search input */}
            <div className="hidden sm:flex items-center gap-2 rounded-xl bg-[#EAF0F6] px-3 py-2 flex-1 max-w-md focus-within:ring-1 focus-within:ring-[#0695A8] focus-within:border-[#0695A8] transition-all">
              <Search className="h-4 w-4 text-[#6B8299] shrink-0" />
              <input
                type="text"
                placeholder="Search modules, findings, records..."
                className="w-full bg-transparent text-sm text-[#1B2A4A] placeholder-[#6B8299] outline-none"
              />
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {/* Page title badge */}
            <span className="hidden md:inline-block text-sm font-medium text-[#6B8299] truncate max-w-[160px]">
              {pageTitle}
            </span>

            {/* Export button — orange CTA */}
            <Link href="/reports" className="hidden sm:flex items-center gap-1.5 rounded-xl bg-[#E8913A] px-4 py-2 text-sm font-medium text-white hover:bg-[#D4822E] transition-colors">
              <Download className="h-4 w-4" />
              Export
            </Link>

            <NotificationBell />
            <div className="ml-1">
              <UserButton />
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1600px] p-4 sm:p-5 lg:p-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
