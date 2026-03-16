import { headers } from "next/headers";
import { stripe } from "@/lib/stripe";
import { provisionLicence, revokeLicence } from "@/lib/licence";
import { getSubscriptionModules } from "@/lib/stripe";
import type Stripe from "stripe";

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";

export async function POST(request: Request) {
  const body = await request.text();
  const headersList = await headers();
  const signature = headersList.get("stripe-signature");

  if (!signature) {
    return new Response("Missing Stripe-Signature header", { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`Webhook signature verification failed: ${message}`);
    return new Response(`Webhook Error: ${message}`, { status: 400 });
  }

  try {
    switch (event.type) {
      case "customer.subscription.created": {
        const subscription = event.data.object as Stripe.Subscription;
        const modules = await getSubscriptionModules(subscription.id);
        const customerId =
          typeof subscription.customer === "string"
            ? subscription.customer
            : subscription.customer.id;

        // Provision licence — expiry = subscription current_period_end
        const expiresAt = new Date(
          subscription.current_period_end * 1000
        ).toISOString();

        await provisionLicence(
          customerId,
          modules,
          expiresAt,
          `Stripe subscription ${subscription.id}`
        );
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const modules = await getSubscriptionModules(subscription.id);
        // Update handled by provisioning a new key or updating KV directly
        // For now, log the update
        console.log(
          `Subscription updated: ${subscription.id}, modules: ${modules.join(",")}`
        );
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        // Find and revoke the licence key for this customer
        const customerId =
          typeof subscription.customer === "string"
            ? subscription.customer
            : subscription.customer.id;
        console.log(
          `Subscription deleted for customer ${customerId} — licence should be revoked`
        );
        // The licence key would be stored in the customer's metadata
        // In production, look up the key from Clerk user metadata
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerEmail = invoice.customer_email;
        console.error(
          `Payment failed for ${customerEmail || "unknown"} — invoice ${invoice.id}`
        );
        // In production: send alert email via Resend
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }
  } catch (err) {
    console.error(`Error processing webhook ${event.type}:`, err);
    return new Response("Webhook processing error", { status: 500 });
  }

  return new Response("OK", { status: 200 });
}
