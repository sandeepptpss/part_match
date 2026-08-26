import prisma from "./db.server";

// Controls whether billing.request()/billing.cancel() create real charges.
// Real money only moves when this app is actually running with NODE_ENV=production.
export const isTestCharge = process.env.NODE_ENV !== "production";

export const PLAN_TIERS = {
  free: {
    label: "Starter Free",
    fitmentLimit: 100,
    universalProducts: false,
    fitmentChecker: false,
    csvImportExport: false,
    garageSync: false,
    analyticsDetail: "basic",
  },
  growth: {
    label: "Growth Professional",
    fitmentLimit: 5000,
    universalProducts: true,
    fitmentChecker: true,
    csvImportExport: true,
    garageSync: true,
    analyticsDetail: "detailed",
  },
  enterprise: {
    label: "Enterprise Unlimited",
    fitmentLimit: Infinity,
    universalProducts: true,
    fitmentChecker: true,
    csvImportExport: true,
    garageSync: true,
    analyticsDetail: "detailed",
  },
};

export const BILLING_PLAN_KEYS = {
  growth: { monthly: "growth_monthly", annual: "growth_annual" },
  enterprise: { monthly: "enterprise_monthly", annual: "enterprise_annual" },
};

export const ALL_BILLING_PLAN_KEYS = Object.values(BILLING_PLAN_KEYS).flatMap((cycles) =>
  Object.values(cycles),
);

export function planLimits(planId) {
  return PLAN_TIERS[planId] || PLAN_TIERS.free;
}

export function resolveTierFromBillingName(name) {
  for (const [plan, cycles] of Object.entries(BILLING_PLAN_KEYS)) {
    for (const [billingCycle, key] of Object.entries(cycles)) {
      if (key === name) return { plan, billingCycle };
    }
  }
  return null;
}

export async function getShopPlan(shop) {
  try {
    const record = await prisma.shopPlan?.findUnique({ where: { shop } });
    if (!record) return { shop, plan: "free", billingCycle: "monthly", subscriptionId: null };
    return record;
  } catch (err) {
    console.error("getShopPlan fallback:", err);
    return { shop, plan: "free", billingCycle: "monthly", subscriptionId: null };
  }
}

// Live-checks Shopify for the shop's active subscription and caches the result.
// Only call this from low-traffic admin routes (e.g. the Plans page) — everywhere
// else should read the cached row via getShopPlan().
export async function syncShopPlanFromBilling(billing, shop) {
  try {
    const { appSubscriptions } = await billing.check({ plans: ALL_BILLING_PLAN_KEYS });

    const active = appSubscriptions?.[0];
    const tier = active ? resolveTierFromBillingName(active.name) : null;

    const data = tier
      ? { plan: tier.plan, billingCycle: tier.billingCycle, subscriptionId: active.id }
      : { plan: "free", billingCycle: "monthly", subscriptionId: null };

    return await prisma.shopPlan?.upsert({
      where: { shop },
      update: data,
      create: { shop, ...data },
    });
  } catch (err) {
    console.error("syncShopPlanFromBilling fallback:", err);
    return { shop, plan: "free", billingCycle: "monthly", subscriptionId: null };
  }
}
