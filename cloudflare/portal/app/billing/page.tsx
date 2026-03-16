import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { stripe } from "@/lib/stripe";

export default async function BillingPage() {
  const { userId } = await auth();
  if (!userId) redirect("/");

  const user = await currentUser();
  const stripeCustomerId = user?.publicMetadata?.stripeCustomerId as
    | string
    | undefined;

  if (stripeCustomerId) {
    // Redirect to Stripe Customer Portal
    const session = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: "https://portal.dqagent.vantax.co.za/dashboard",
    });
    redirect(session.url);
  }

  // No Stripe customer yet — show plan options
  return (
    <div className="mx-auto max-w-4xl space-y-8 p-8">
      <h1 className="text-2xl font-bold text-white">Choose a Plan</h1>
      <p className="text-[var(--muted)]">
        Select a plan to get started with Vantax SAP Data Quality Agent.
      </p>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {/* Starter */}
        <div className="rounded-lg bg-[var(--card)] border border-[var(--border)] p-6 space-y-4">
          <h2 className="text-lg font-semibold text-white">Starter</h2>
          <p className="text-3xl font-bold text-white">
            R 8,500<span className="text-sm text-[var(--muted)]">/mo</span>
          </p>
          <p className="text-sm text-[var(--muted)]">Annual billing: R 86,700/year</p>
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
            R 22,000<span className="text-sm text-[var(--muted)]">/mo</span>
          </p>
          <p className="text-sm text-[var(--muted)]">Annual billing: R 224,400/year</p>
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
            R 65,000<span className="text-sm text-[var(--muted)]">/mo</span>
          </p>
          <p className="text-sm text-[var(--muted)]">Annual billing: R 663,000/year</p>
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
