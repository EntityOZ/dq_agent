import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { UserButton } from "@clerk/nextjs";

const NAV = [
  { href: "/admin/dashboard", label: "Dashboard" },
  { href: "/admin/tenants", label: "Tenants" },
  { href: "/admin/rules", label: "Rules Engine" },
];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId, sessionClaims } = await auth();
  if (!userId) redirect("/sign-in");

  const isAdmin =
    (sessionClaims?.publicMetadata as { is_meridian_admin?: boolean })
      ?.is_meridian_admin === true;
  if (!isAdmin) redirect("/dashboard");

  const user = await currentUser();

  return (
    <div className="min-h-screen" style={{ background: "var(--background)" }}>
      {/* Top nav */}
      <header
        style={{ borderBottom: "1px solid var(--border)" }}
        className="flex items-center justify-between px-6 py-3"
      >
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-2">
            <div
              className="flex h-7 w-7 items-center justify-center rounded-md text-white text-xs font-bold"
              style={{ background: "var(--primary)" }}
            >
              M
            </div>
            <span className="text-sm font-semibold text-white">
              Meridian HQ
            </span>
            <span
              className="ml-1 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
              style={{ background: "var(--primary)", color: "#fff", opacity: 0.8 }}
            >
              Admin
            </span>
          </div>

          <nav className="flex items-center gap-1">
            {NAV.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className="rounded px-3 py-1.5 text-sm transition-colors"
                style={{ color: "var(--muted)" }}
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            {user?.emailAddresses[0]?.emailAddress}
          </span>
          <UserButton />
        </div>
      </header>

      {/* Page content */}
      <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
    </div>
  );
}
