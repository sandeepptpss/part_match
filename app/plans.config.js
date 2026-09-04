/* global process */
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
    fitmentChecker: true,
    csvImportExport: false,
    garageSync: false,
    analyticsDetail: "basic",
    aiFitmentSuggestions: false,
    vinLookup: false,
    vinMonthlyLimit: 0,
    vinOverageRate: 0,
    acesPiesSupport: false,
    competitorMigration: false,
    voiceSearchAssistant: false,
  },
  starter: {
    label: "Starter Pro",
    fitmentLimit: 3000,
    universalProducts: true,
    fitmentChecker: true,
    csvImportExport: true,
    garageSync: false,
    analyticsDetail: "standard",
    aiFitmentSuggestions: false,
    vinLookup: true,
    vinMonthlyLimit: 25,
    vinOverageRate: 0.08,
    acesPiesSupport: false,
    competitorMigration: false,
    voiceSearchAssistant: false,
  },
  growth: {
    label: "Growth Pro",
    fitmentLimit: 20000,
    universalProducts: true,
    fitmentChecker: true,
    csvImportExport: true,
    garageSync: true,
    analyticsDetail: "detailed",
    aiFitmentSuggestions: false,
    vinLookup: true,
    vinMonthlyLimit: 250,
    vinOverageRate: 0.05,
    acesPiesSupport: true,
    competitorMigration: true,
    voiceSearchAssistant: true,
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
    vinLookup: true,
    vinMonthlyLimit: 1000,
    vinOverageRate: 0.03,
    acesPiesSupport: true,
    competitorMigration: true,
    voiceSearchAssistant: true,
  },
};

export const BILLING_PLAN_KEYS = {
  starter: { monthly: "starter_monthly", annual: "starter_annual" },
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
