import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getLicenceStatus } from "@/lib/licence";

const ALL_FEATURES = [
  { key: "cleaning", label: "Data Cleaning", description: "Automated data standardisation and deduplication" },
  { key: "exceptions", label: "Exception Management", description: "SLA-driven exception workflows with billing tiers" },
  { key: "analytics", label: "Advanced Analytics", description: "Predictive, prescriptive, and impact analytics" },
  { key: "nlp", label: "NLP Query Interface", description: "Natural language queries over data quality metrics" },
  { key: "contracts", label: "Data Contracts", description: "Schema enforcement and data lineage tracking" },
  { key: "notifications", label: "Notification Centre", description: "Real-time alerts, digest emails, and Teams webhooks" },
] as const;

export default async function BillingPage() {
  const { userId } = await auth();
  if (!userId) redirect("/");

  const user = await currentUser();
  const licenceKey = user?.publicMetadata?.licenceKey as string | undefined;

  let licenceFeatures: string[] = [];
  if (licenceKey) {
    try {
      const status = await getLicenceStatus(licenceKey);
      licenceFeatures = (status as { features?: string[] }).features || [];
    } catch {
      // Licence server unreachable — show empty state
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-8">
      <h1 className="text-2xl font-bold text-white">Billing</h1>

      {/* ── Feature Licences ──────────────────────────────────────────── */}
      <div className="rounded-lg bg-[var(--card)] border border-[var(--border)] p-6 space-y-4">
        <h2 className="text-lg font-semibold text-white">Feature Licences</h2>
        <p className="text-sm text-[var(--muted)]">
          Features enabled in your current licence. Contact sales or upgrade to
          add more capabilities.
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {ALL_FEATURES.map(({ key, label, description }) => {
            const enabled = licenceFeatures.includes(key);
            return (
              <div
                key={key}
                className={`flex items-start gap-3 rounded-lg border p-4 ${
                  enabled
                    ? "border-[var(--primary)]/40 bg-[var(--primary)]/5"
                    : "border-[var(--border)] opacity-60"
                }`}
              >
                <span
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    enabled
                      ? "bg-[var(--primary)] text-white"
                      : "bg-[var(--border)] text-[var(--muted)]"
                  }`}
                >
                  {enabled ? "\u2713" : "\u2717"}
                </span>
                <div>
                  <p className="text-sm font-medium text-white">{label}</p>
                  <p className="text-xs text-[var(--muted)]">{description}</p>
                  {!enabled && (
                    <a
                      href="https://meridian-hq.vantax.co.za/upgrade"
                      className="mt-1 inline-block text-xs text-[var(--primary)] hover:underline"
                    >
                      Upgrade to enable
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Plans ─────────────────────────────────────────────────────── */}
      <h2 className="text-lg font-semibold text-white">Plans</h2>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            {/* Starter */}
            <div className="rounded-lg bg-[var(--card)] border border-[var(--border)] p-6 space-y-4">
              <h2 className="text-lg font-semibold text-white">Starter</h2>
              <p className="text-3xl font-bold text-white">
                R 8,500<span className="text-sm text-[var(--muted)]">/mo</span>
              </p>
              <p className="text-sm text-[var(--muted)]">
                Annual billing: R 86,700/year
              </p>
              <ul className="space-y-2 text-sm text-[var(--muted)]">
                <li>Business Partner</li>
                <li>Material Master</li>
                <li>GL Accounts</li>
              </ul>
              <button className="w-full rounded-md bg-[var(--primary)] py-2 text-sm text-white hover:opacity-90">
                Get Started
              </button>
            </div>

            {/* Growth */}
            <div className="rounded-lg bg-[var(--card)] border-2 border-[var(--primary)] p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">Growth</h2>
                <span className="rounded-full bg-[var(--primary)]/20 px-2 py-1 text-xs text-[var(--primary)]">
                  Popular
                </span>
              </div>
              <p className="text-3xl font-bold text-white">
                R 22,000
                <span className="text-sm text-[var(--muted)]">/mo</span>
              </p>
              <p className="text-sm text-[var(--muted)]">
                Annual billing: R 224,400/year
              </p>
              <ul className="space-y-2 text-sm text-[var(--muted)]">
                <li>10 SAP modules</li>
                <li>Priority support</li>
              </ul>
              <button className="w-full rounded-md bg-[var(--primary)] py-2 text-sm text-white hover:opacity-90">
                Get Started
              </button>
            </div>

            {/* Enterprise */}
            <div className="rounded-lg bg-[var(--card)] border border-[var(--border)] p-6 space-y-4">
              <h2 className="text-lg font-semibold text-white">Enterprise</h2>
              <p className="text-3xl font-bold text-white">
                R 65,000
                <span className="text-sm text-[var(--muted)]">/mo</span>
              </p>
              <p className="text-sm text-[var(--muted)]">
                Annual billing: R 663,000/year
              </p>
              <ul className="space-y-2 text-sm text-[var(--muted)]">
                <li>All 29 SAP modules</li>
                <li>Dedicated support</li>
                <li>Custom integrations</li>
              </ul>
              <button className="w-full rounded-md bg-[var(--primary)] py-2 text-sm text-white hover:opacity-90">
                Contact Sales
              </button>
            </div>
      </div>
    </div>
  );
}
