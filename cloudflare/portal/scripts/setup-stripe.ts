/**
 * One-time Stripe product setup script.
 *
 * Usage: npx tsx scripts/setup-stripe.ts
 *
 * Requires: STRIPE_SECRET_KEY environment variable
 */

import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2025-02-24.acacia",
});

interface ProductDef {
  name: string;
  priceMonthly: number; // ZAR cents
  priceAnnual: number; // ZAR cents
  metadata: Record<string, string>;
}

const PRODUCTS: ProductDef[] = [
  {
    name: "Vantax DQ Agent — Starter",
    priceMonthly: 850000, // R 8,500
    priceAnnual: 8670000, // R 86,700
    metadata: { modules: "business_partner,material_master,fi_gl" },
  },
  {
    name: "Vantax DQ Agent — Growth",
    priceMonthly: 2200000, // R 22,000
    priceAnnual: 22440000, // R 224,400
    metadata: {
      modules:
        "business_partner,material_master,fi_gl,employee_central,ap_ar,sd_customer,mm_purchasing,pp_production,pm_plant,qm_quality",
    },
  },
  {
    name: "Vantax DQ Agent — Enterprise",
    priceMonthly: 6500000, // R 65,000
    priceAnnual: 66300000, // R 663,000
    metadata: { modules: "all" },
  },
];

const ADDONS: { name: string; module: string; priceMonthly: number }[] = [
  { name: "Employee Central Add-on", module: "employee_central", priceMonthly: 250000 },
  { name: "AP/AR Add-on", module: "ap_ar", priceMonthly: 200000 },
  { name: "SD Customer Add-on", module: "sd_customer", priceMonthly: 200000 },
  { name: "eWMS Stock Add-on", module: "ewms_stock", priceMonthly: 250000 },
];

async function main() {
  console.log("Setting up Stripe products for Vantax...\n");

  // Create tier products
  for (const prod of PRODUCTS) {
    console.log(`Creating product: ${prod.name}`);
    const product = await stripe.products.create({
      name: prod.name,
      metadata: prod.metadata,
    });

    // Monthly price
    const monthlyPrice = await stripe.prices.create({
      product: product.id,
      unit_amount: prod.priceMonthly,
      currency: "zar",
      recurring: { interval: "month" },
    });
    console.log(`  Monthly price: ${monthlyPrice.id} (R ${prod.priceMonthly / 100}/mo)`);

    // Annual price
    const annualPrice = await stripe.prices.create({
      product: product.id,
      unit_amount: prod.priceAnnual,
      currency: "zar",
      recurring: { interval: "year" },
    });
    console.log(`  Annual price:  ${annualPrice.id} (R ${prod.priceAnnual / 100}/yr)`);
    console.log();
  }

  // Create add-on products
  for (const addon of ADDONS) {
    console.log(`Creating add-on: ${addon.name}`);
    const product = await stripe.products.create({
      name: addon.name,
      metadata: { module: addon.module },
    });

    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: addon.priceMonthly,
      currency: "zar",
      recurring: { interval: "month" },
    });
    console.log(`  Price: ${price.id} (R ${addon.priceMonthly / 100}/mo)`);
    console.log();
  }

  console.log("Done! Save the price IDs above for your environment configuration.");
}

main().catch((err) => {
  console.error("Setup failed:", err);
  process.exit(1);
});
