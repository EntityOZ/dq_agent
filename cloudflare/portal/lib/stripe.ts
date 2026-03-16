import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2025-02-24.acacia",
});

export { stripe };

export async function getOrCreateStripeCustomer(
  clerkUserId: string,
  email: string
): Promise<string> {
  // Search for existing customer by Clerk user ID in metadata
  const existing = await stripe.customers.search({
    query: `metadata["clerkUserId"]:"${clerkUserId}"`,
  });

  if (existing.data.length > 0) {
    return existing.data[0].id;
  }

  // Create new customer
  const customer = await stripe.customers.create({
    email,
    metadata: { clerkUserId },
  });

  return customer.id;
}

export async function createCheckoutSession(
  customerId: string,
  priceId: string,
  successUrl: string,
  cancelUrl: string
): Promise<string> {
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    payment_method_types: ["card"],
    line_items: [{ price: priceId, quantity: 1 }],
    mode: "subscription",
    success_url: successUrl,
    cancel_url: cancelUrl,
  });

  return session.url || "";
}

export async function getSubscriptionModules(
  subscriptionId: string
): Promise<string[]> {
  const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
    expand: ["items.data.price.product"],
  });

  const modules: string[] = [];
  for (const item of subscription.items.data) {
    const product = item.price.product as Stripe.Product;
    const modulesMeta = product.metadata?.modules;
    if (modulesMeta === "all") {
      return ["all"];
    }
    if (modulesMeta) {
      modules.push(...modulesMeta.split(",").map((m) => m.trim()));
    }
    const singleModule = product.metadata?.module;
    if (singleModule) {
      modules.push(singleModule);
    }
  }

  return [...new Set(modules)];
}
