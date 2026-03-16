"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import { User } from "lucide-react";

// Dynamically import UserButton — only loads when Clerk is configured
const UserButton = dynamic(
  () => import("@clerk/nextjs").then((mod) => mod.UserButton),
  {
    ssr: false,
    loading: () => <User className="h-6 w-6 text-muted-foreground" />,
  }
);
import {
  LayoutDashboard,
  Upload,
  Search,
  GitCompareArrows,
  FileText,
  Settings,
  ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useQuery } from "@tanstack/react-query";
import apiClient from "@/lib/api/client";
import type { HealthResponse } from "@/types/api";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/upload", label: "Upload", icon: Upload },
  { href: "/findings", label: "Findings", icon: Search },
  { href: "/versions", label: "Versions", icon: GitCompareArrows },
  { href: "/reports", label: "Reports", icon: FileText },
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

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-[#16162B]">
        {/* Logo */}
        <div className="flex h-14 items-center gap-2 px-4">
          <ShieldCheck className="h-6 w-6 text-[#0F6E56]" />
          <span className="text-lg font-bold text-white">Vantax</span>
        </div>
        <Separator />

        {/* Nav */}
        <nav className="flex-1 space-y-1 px-2 py-3">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active =
              href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "bg-[#0F6E56]/15 text-[#0F6E56]"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="border-t border-border p-3">
          <Badge
            variant={health?.status === "ok" ? "default" : "destructive"}
            className={
              health?.status === "ok"
                ? "bg-green-600 hover:bg-green-700"
                : ""
            }
          >
            {health?.status === "ok" ? "Licence Active" : "Licence Unknown"}
          </Badge>
        </div>
      </aside>

      {/* Main */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-[#16162B] px-6">
          <span className="text-sm text-muted-foreground">
            SAP Data Quality Agent
          </span>
          <div className="flex items-center gap-4">
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
