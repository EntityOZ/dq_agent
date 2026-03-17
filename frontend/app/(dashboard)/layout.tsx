"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import { User } from "lucide-react";

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
  Sparkles,
  GitMerge,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useQuery } from "@tanstack/react-query";
import apiClient from "@/lib/api/client";
import type { HealthResponse } from "@/types/api";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/upload", label: "Upload", icon: Upload },
  { href: "/findings", label: "Findings", icon: AlertTriangle },
  { href: "/versions", label: "Versions", icon: GitCompareArrows },
  { href: "/reports", label: "Reports", icon: FileText },
  { href: "/cleaning", label: "Cleaning", icon: Sparkles },
  { href: "/dedup", label: "Dedup", icon: GitMerge },
  { href: "/settings", label: "Settings", icon: Settings },
];

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

  return (
    <div className="flex h-screen overflow-hidden bg-[#F0F5FA]">
      {/* Sidebar — icon only, 56px, deep navy */}
      <aside className="relative z-50 flex w-14 shrink-0 flex-col items-center border-r border-white/10 bg-[#0F2137] py-3">
        {/* Logo */}
        <div className="mb-4 flex h-8 w-8 items-center justify-center">
          <ShieldCheck className="h-5 w-5 text-[#0695A8]" />
        </div>

        {/* Nav icons */}
        <TooltipProvider delay={0}>
          <nav className="flex flex-1 flex-col items-center gap-1">
            {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
              const active =
                href === "/" ? pathname === "/" : pathname.startsWith(href);
              return (
                <Tooltip key={href}>
                  <TooltipTrigger
                    render={
                      <Link
                        href={href}
                        className={`flex h-10 w-10 items-center justify-center rounded-lg transition-colors ${
                          active
                            ? "bg-white/10 text-white border-l-2 border-l-[#0695A8]"
                            : "text-[#A8C5D8] hover:bg-white/5 hover:text-white"
                        }`}
                      />
                    }
                  >
                    <Icon className="h-[18px] w-[18px]" />
                  </TooltipTrigger>
                  <TooltipContent
                    side="right"
                    sideOffset={12}
                    className="z-[9999] bg-[var(--vx-sidebar-bg,#0F2137)] text-white border border-[var(--vx-border,#D6E4F0)] shadow-lg text-sm font-medium"
                  >
                    {label}
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </nav>
        </TooltipProvider>

        {/* Bottom — V monogram + licence dot */}
        <div className="flex flex-col items-center gap-2">
          <div className={`h-2 w-2 rounded-full ${licenceDotColor} ${licencePulse}`} />
          <span className="font-display text-sm font-bold text-[#0695A8]">V</span>
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
            <UserButton />
          </div>
        </header>

        {/* Content */}
        <ScrollArea className="flex-1">
          <main className="p-6">{children}</main>
        </ScrollArea>
      </div>
    </div>
  );
}
