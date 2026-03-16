import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getLicenceStatus, getLicencePings } from "@/lib/licence";

function maskKey(key: string): string {
  if (key.length <= 4) return key;
  const last4 = key.slice(-4);
  return `XXXX-XXXX-XXXX-${last4}`;
}

export default async function DashboardPage() {
  const { userId } = await auth();
  if (!userId) redirect("/");

  const user = await currentUser();
  const licenceKey = user?.publicMetadata?.licenceKey as string | undefined;

  let licence = null;
  let pings: { lastSeen: string; machineFingerprint: string }[] = [];

  if (licenceKey) {
    try {
      licence = await getLicenceStatus(licenceKey);
    } catch {
      licence = null;
    }
    try {
      const pingData = await getLicencePings(licenceKey);
      pings = pingData.pings.map((p) => ({
        lastSeen: p.lastSeen,
        machineFingerprint: p.machineFingerprint.slice(-8),
      }));
    } catch {
      pings = [];
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-8">
      <h1 className="text-2xl font-bold text-white">Licence Dashboard</h1>

      {!licenceKey && (
        <div className="rounded-lg bg-[var(--card)] border border-[var(--border)] p-6">
          <p className="text-[var(--muted)]">
            No licence key found. Subscribe to a plan to get started.
          </p>
          <a
            href="/billing"
            className="mt-4 inline-block rounded-md bg-[var(--primary)] px-4 py-2 text-white hover:opacity-90"
          >
            View Plans
          </a>
        </div>
      )}

      {licenceKey && (
        <>
          {/* Licence overview */}
          <div className="rounded-lg bg-[var(--card)] border border-[var(--border)] p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">
                Your Licence
              </h2>
              <span
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  licence?.valid
                    ? "bg-green-600/20 text-green-400"
                    : "bg-red-600/20 text-red-400"
                }`}
              >
                {licence?.valid ? "Active" : "Inactive"}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-[var(--muted)]">Licence Key</p>
                <p className="font-mono text-white">{maskKey(licenceKey)}</p>
              </div>
              <div>
                <p className="text-[var(--muted)]">Expires</p>
                <p className="text-white">
                  {licence?.expiresAt
                    ? new Date(licence.expiresAt).toLocaleDateString()
                    : "Unknown"}
                </p>
              </div>
              <div>
                <p className="text-[var(--muted)]">Days Remaining</p>
                <p className="text-white">
                  {licence?.daysRemaining ?? "Unknown"}
                </p>
              </div>
            </div>

            {/* Modules */}
            <div>
              <p className="text-sm text-[var(--muted)] mb-2">
                Licensed Modules
              </p>
              <div className="flex flex-wrap gap-2">
                {licence?.modules.map((mod) => (
                  <span
                    key={mod}
                    className="rounded-md bg-[var(--primary)]/20 px-2 py-1 text-xs text-[var(--primary)]"
                  >
                    {mod.replace(/_/g, " ")}
                  </span>
                ))}
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <a
                href="/billing"
                className="rounded-md bg-[var(--primary)] px-4 py-2 text-sm text-white hover:opacity-90"
              >
                Renew Licence
              </a>
            </div>
          </div>

          {/* Add modules */}
          <div className="rounded-lg bg-[var(--card)] border border-[var(--border)] p-6">
            <h2 className="text-lg font-semibold text-white mb-4">
              Add Modules
            </h2>
            <p className="text-sm text-[var(--muted)] mb-4">
              Expand your analysis coverage with additional SAP modules.
            </p>
            <div className="grid grid-cols-2 gap-3">
              {[
                { name: "employee_central", price: "R 2,500/mo" },
                { name: "ap_ar", price: "R 2,000/mo" },
                { name: "sd_customer", price: "R 2,000/mo" },
                { name: "ewms_stock", price: "R 2,500/mo" },
              ]
                .filter((m) => !licence?.modules.includes(m.name))
                .map((mod) => (
                  <div
                    key={mod.name}
                    className="flex items-center justify-between rounded-md border border-[var(--border)] p-3"
                  >
                    <span className="text-sm text-white">
                      {mod.name.replace(/_/g, " ")}
                    </span>
                    <span className="text-xs text-[var(--muted)]">
                      {mod.price}
                    </span>
                  </div>
                ))}
            </div>
          </div>

          {/* Recent pings */}
          {pings.length > 0 && (
            <div className="rounded-lg bg-[var(--card)] border border-[var(--border)] p-6">
              <h2 className="text-lg font-semibold text-white mb-4">
                Recent Activity
              </h2>
              <div className="space-y-2">
                {pings.map((ping, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="text-[var(--muted)]">
                      Last seen:{" "}
                      {new Date(ping.lastSeen).toLocaleString()}
                    </span>
                    <span className="font-mono text-xs text-[var(--muted)]">
                      ...{ping.machineFingerprint}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
