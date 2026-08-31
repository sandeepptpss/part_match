// Controls whether billing.request()/billing.cancel() create real charges.
// Real money only moves when this app is actually running with NODE_ENV=production.
export function getIsTestCharge(shop = "") {
  if (process.env.SHOPIFY_BILLING_TEST === "true" || process.env.SHOPIFY_BILLING_TEST === "1") {
    return true;
  }
  if (process.env.SHOPIFY_BILLING_TEST === "false" || process.env.SHOPIFY_BILLING_TEST === "0") {
    return false;
  }
  if (process.env.NODE_ENV !== "production") {
    return true;
  }
  const shopDomain = (shop || "").toLowerCase();
  if (
    shopDomain.includes("quickstart") ||
    shopDomain.includes("myshopify.dev") ||
    shopDomain.includes("spin") ||
    shopDomain.includes("dev-store") ||
    shopDomain.includes("test")
  ) {
    return true;
  }
  return false;
}

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
    aiFitmentSuggestions: false,
  },
  growth: {
    label: "Growth Professional",
    fitmentLimit: 5000,
    universalProducts: true,
    fitmentChecker: true,
    csvImportExport: true,
    garageSync: true,
    analyticsDetail: "detailed",
    aiFitmentSuggestions: false,
  },
  enterprise: {
    label: "Enterprise Unlimited",
    fitmentLimit: Infinity,
    universalProducts: true,
    fitmentChecker: true,
    csvImportExport: true,
    garageSync: true,
    analyticsDetail: "detailed",
    aiFitmentSuggestions: true,
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
