import prisma from "./db.server.js";
import {
  PLAN_TIERS,
  BILLING_PLAN_KEYS,
  ALL_BILLING_PLAN_KEYS,
  planLimits,
  resolveTierFromBillingName,
  getIsTestCharge,
  isTestCharge,
} from "./plans.config.js";

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
    const adminStore = (process.env.ADMIN_STORE_NAME || "").toLowerCase().trim();
    const shopDomain = (shop || "").toLowerCase().trim();
    const record = await prisma.shopPlan?.findUnique({ where: { shop } });

    if (adminStore && (shopDomain === adminStore || shopDomain === `${adminStore}.myshopify.com`)) {
      if (record?.plan) return record;
      return { shop, plan: "enterprise", billingCycle: "monthly", subscriptionId: "admin-dev-plan" };
    }

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
    const adminStore = (process.env.ADMIN_STORE_NAME || "").toLowerCase().trim();
    const shopDomain = (shop || "").toLowerCase().trim();
    const isAdminStore = adminStore && (shopDomain === adminStore || shopDomain === `${adminStore}.myshopify.com`);

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
    } else {
      // If admin development store, maintain enterprise or configured plan
      if (isAdminStore) {
        return await getShopPlan(shop);
      }

      // Shopify has no active subscription. If not on an active VIP grant or manual admin quote, sync status to free
      const appSettings = await prisma.appSettings?.findFirst({ where: { shop } });
      const current = await getShopPlan(shop);
      if (!appSettings?.vipFreeOfferActive && !current?.isManualGrant) {
        if (current?.plan && current.plan !== "free") {
          return await prisma.shopPlan?.upsert({
            where: { shop },
            update: { plan: "free", billingCycle: "monthly", subscriptionId: null },
            create: { shop, plan: "free", billingCycle: "monthly", subscriptionId: null },
          });
        }
      }
    }
  } catch (err) {
    console.error("syncShopPlanFromBilling fallback:", err);
  }
  return await getShopPlan(shop);
}
