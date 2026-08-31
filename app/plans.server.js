import prisma from "./db.server";
import {
  PLAN_TIERS,
  BILLING_PLAN_KEYS,
  ALL_BILLING_PLAN_KEYS,
  planLimits,
  resolveTierFromBillingName,
  getIsTestCharge,
  isTestCharge,
} from "./plans.config";

export {
  PLAN_TIERS,
  BILLING_PLAN_KEYS,
  ALL_BILLING_PLAN_KEYS,
  planLimits,
  resolveTierFromBillingName,
  getIsTestCharge,
  isTestCharge,
};

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

    if (tier) {
      const data = { plan: tier.plan, billingCycle: tier.billingCycle, subscriptionId: active.id };
      return await prisma.shopPlan?.upsert({
        where: { shop },
        update: data,
        create: { shop, ...data },
      });
    }
  } catch (err) {
    console.error("syncShopPlanFromBilling fallback:", err);
  }
  return await getShopPlan(shop);
}
