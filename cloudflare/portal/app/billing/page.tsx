import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { stripe } from "@/lib/stripe";
import { getLicenceStatus } from "@/lib/licence";

const ALL_FEATURES = [
  { key: "cleaning", label: "Data Cleaning", description: "Automated data standardisation and deduplication" },
  { key: "exceptions", label: "Exception Management", description: "SLA-driven exception workflows with billing tiers" },
  { key: "analytics", label: "Advanced Analytics", description: "Predictive, prescriptive, and impact analytics" },
  { key: "nlp", label: "NLP Query Interface", description: "Natural language queries over data quality metrics" },
  { key: "contracts", label: "Data Contracts", description: "Schema enforcement and data lineage tracking" },
  { key: "notifications", label: "Notification Centre", description: "Real-time alerts, digest emails, and Teams webhooks" },
] as const;

const TIER_INFO = [
  { tier: 1, label: "Tier 1 — Auto-resolved", price: "R25.00" },
  { tier: 2, label: "Tier 2 — Steward", price: "R150.00" },
  { tier: 3, label: "Tier 3 — Complex", price: "R500.00" },
  { tier: 4, label: "Tier 4 — Custom Rule", price: "R250.00" },
] as const;

export default async function BillingPage() {
  const { userId } = await auth();
  if (!userId) redirect("/");

  const user = await currentUser();
  const stripeCustomerId = user?.publicMetadata?.stripeCustomerId as
    | string
    | undefined;
  const licenceKey = user?.publicMetadata?.licenceKey as string | undefined;

  // Fetch licence status for feature flags
  let licenceFeatures: string[] = [];
  let licenceModules: string[] = [];
  if (licenceKey) {
    try {
      const status = await getLicenceStatus(licenceKey);
      licenceFeatures = (status as { features?: string[] }).features || [];
      licenceModules = status.modules || [];
    } catch {
      // Licence server unreachable — show empty state
    }
  }

  // Fetch exception billing summary for current month from Stripe
  let exceptionBilling: {
    tier1_count: number;
    tier2_count: number;
    tier3_count: number;
    tier4_count: number;
    tier1_amount: number;
    tier2_amount: number;
    tier3_amount: number;
    tier4_amount: number;
    base_fee: number;
    total_amount: number;
  } | null = null;

  if (stripeCustomerId) {
    try {
      // Get recent invoices to extract exception billing data
      const invoices = await stripe.invoices.list({
        customer: stripeCustomerId,
        limit: 1,
      });
      if (invoices.data.length > 0) {
        const latest = invoices.data[0];
        const tierCounts = [0, 0, 0, 0];
        const tierAmounts = [0, 0, 0, 0];
        let baseFee = 0;

        for (const line of latest.lines?.data || []) {
          const desc = line.description || "";
          if (desc.includes("Base Fee")) {
            baseFee = (line.amount || 0) / 100;
          }
          for (let i = 1; i <= 4; i++) {
            if (desc.includes(`Tier ${i}`)) {
              tierAmounts[i - 1] = (line.amount || 0) / 100;
              const match = desc.match(/\((\d+) items/);
              if (match) tierCounts[i - 1] = parseInt(match[1]);
            }
          }
        }

        exceptionBilling = {
          tier1_count: tierCounts[0],
          tier2_count: tierCounts[1],
          tier3_count: tierCounts[2],
          tier4_count: tierCounts[3],
          tier1_amount: tierAmounts[0],
          tier2_amount: tierAmounts[1],
          tier3_amount: tierAmounts[2],
          tier4_amount: tierAmounts[3],
          base_fee: baseFee,
          total_amount: baseFee + tierAmounts.reduce((a, b) => a + b, 0),
        };
      }
    } catch {
      // Stripe fetch failed — show empty state
    }
  }

  if (stripeCustomerId) {
    // Show billing dashboard instead of redirecting
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-8">
      <h1 className="text-2xl font-bold text-white">Billing</h1>

      {/* ── Exception Activity This Month ─────────────────────────────── */}
      <div className="rounded-lg bg-[var(--card)] border border-[var(--border)] p-6 space-y-4">
        <h2 className="text-lg font-semibold text-white">
          Exception Activity This Month
        </h2>

        {exceptionBilling ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left text-[var(--muted)]">
                    <th className="px-3 py-2">Tier</th>
                    <th className="px-3 py-2 text-right">Count</th>
                    <th className="px-3 py-2 text-right">Unit Price</th>
                    <th className="px-3 py-2 text-right">Amount (ZAR)</th>
                  </tr>
                </thead>
                <tbody>
                  {TIER_INFO.map(({ tier, label, price }) => {
                    const count =
                      exceptionBilling[
                        `tier${tier}_count` as keyof typeof exceptionBilling
                      ] || 0;
                    const amount =
                      exceptionBilling[
                        `tier${tier}_amount` as keyof typeof exceptionBilling
                      ] || 0;
                    return (
                      <tr
                        key={tier}
                        className="border-b border-[var(--border)]/50"
                      >
                        <td className="px-3 py-2 text-white">{label}</td>
                        <td className="px-3 py-2 text-right text-white">
                          {count}
                        </td>
                        <td className="px-3 py-2 text-right text-[var(--muted)]">
                          {price}
                        </td>
                        <td className="px-3 py-2 text-right text-white">
                          R {(amount as number).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="border-b border-[var(--border)]/50">
                    <td className="px-3 py-2 text-[var(--muted)]">
                      Monthly Base Fee
                    </td>
                    <td className="px-3 py-2" />
                    <td className="px-3 py-2" />
                    <td className="px-3 py-2 text-right text-white">
                      R{" "}
                      {exceptionBilling.base_fee.toLocaleString("en-ZA", {
                        minimumFractionDigits: 2,
                      })}
                    </td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr className="font-semibold">
                    <td className="px-3 py-2 text-white">Total</td>
                    <td className="px-3 py-2" />
                    <td className="px-3 py-2" />
                    <td className="px-3 py-2 text-right text-[var(--primary)]">
                      R{" "}
                      {exceptionBilling.total_amount.toLocaleString("en-ZA", {
                        minimumFractionDigits: 2,
                      })}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {stripeCustomerId && (
              <a
                href={`https://billing.stripe.com/p/login/test`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-md bg-[var(--primary)] px-4 py-2 text-sm text-white hover:opacity-90"
              >
                View Invoice in Stripe
              </a>
            )}
          </>
        ) : (
          <p className="text-sm text-[var(--muted)]">
            No exception billing data for this month yet.
          </p>
        )}
      </div>

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

      {/* ── Plan Options (for new customers) ─────────────────────────── */}
      {!stripeCustomerId && (
        <>
          <h2 className="text-lg font-semibold text-white">Choose a Plan</h2>
          <p className="text-[var(--muted)]">
            Select a plan to get started with Meridian SAP Data Quality Agent.
          </p>

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
        </>
      )}
    </div>
  );
}
