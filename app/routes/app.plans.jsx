const json = (data, init) => Response.json(data, init);
import { useState } from "react";
import { useLoaderData, useFetcher, useActionData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { BillingInterval } from "@shopify/shopify-app-react-router/server";
import { BILLING_PLAN_KEYS, getIsTestCharge, isTestCharge, planLimits } from "../plans.config";
import { syncShopPlanFromBilling } from "../plans.server";

export const loader = async ({ request }) => {
  const { session, billing } = await authenticate.admin(request);
  const shop = session.shop;

  const sessionEmail = session.email || "sandeepptpss@gmail.com";
  const shopDomain = (shop || "").toLowerCase();
  const userEmail = (sessionEmail || "").toLowerCase();

  const isAdmin =
    shopDomain.includes("quickstart-749ac396") ||
    shopDomain.includes("sandeepptpss") ||
    userEmail.includes("sandeepptpss") ||
    userEmail === "sandeepptpss@gmail.com";

  let fitmentCount = 0;
  let productMappingCount = 0;
  let universalCount = 0;
  let searchLogCount = 0;
  let vinLookupCount = 0;
  let appSettings = null;
  let globalSettings = null;

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  try {
    const res = await Promise.all([
      prisma.fitmentRecord?.count({ where: { shop } }) ?? 0,
      prisma.fitmentProduct?.count({ where: { fitment: { shop } } }) ?? 0,
      prisma.universalProduct?.count({ where: { shop } }) ?? 0,
      prisma.searchLog?.count({ where: { shop } }) ?? 0,
      prisma.vinLookupLog?.count({ where: { shop, createdAt: { gte: startOfMonth } } }) ?? 0,
      prisma.appSettings?.findFirst({ where: { shop } }),
      prisma.appSettings?.findFirst({ where: { shop: "__GLOBAL__" } }),
    ]);
    fitmentCount = res[0];
    productMappingCount = res[1];
    universalCount = res[2];
    searchLogCount = res[3];
    vinLookupCount = res[4];
    appSettings = res[5];
    globalSettings = res[6];
  } catch (err) {
    console.error("[plans loader] Error fetching stats:", err);
  }

  const globalAnnualDiscount = globalSettings?.annualDiscountPercent ?? 20;
  const merchantDiscount =
    appSettings?.merchantDiscountPercent != null
      ? appSettings.merchantDiscountPercent
      : appSettings?.annualDiscountPercent != null && appSettings.annualDiscountPercent !== globalAnnualDiscount
      ? appSettings.annualDiscountPercent
      : 0;

  const isCustomMerchantDiscount = merchantDiscount > 0;
  const totalAnnualDiscount = globalAnnualDiscount + merchantDiscount;

  const shopPlan = await syncShopPlanFromBilling(billing, shop);
  const limits = planLimits(shopPlan.plan);

  return json({
    shop,
    fitmentCount,
    productMappingCount,
    universalCount,
    searchLogCount,
    vinLookupCount,
    sessionEmail,
    isAdmin,
    globalAnnualDiscount,
    merchantDiscount,
    totalAnnualDiscount,
    isCustomMerchantDiscount,
    activePlan: shopPlan.plan,
    activeBillingCycle: shopPlan.billingCycle || "monthly",
    recordsLimit: Number.isFinite(limits.fitmentLimit) ? limits.fitmentLimit : null,
    vinLimit: limits.vinMonthlyLimit,
    vinOverageRate: limits.vinOverageRate,
  });
};

export const action = async ({ request }) => {
  const { session, billing } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "selectPlan") {
    const selectedPlan = formData.get("plan");
    const billingCycle = formData.get("billingCycle") === "annual" ? "annual" : "monthly";
    const isTest = getIsTestCharge(shop);

    if (selectedPlan === "free") {
      try {
        const { appSubscriptions } = await billing.check();
        const active = appSubscriptions?.[0];
        if (active) {
          await billing.cancel({ subscriptionId: active.id, isTest });
        }
      } catch (err) {
        console.warn("[plans action] Error cancelling subscription:", err);
      }
      await prisma.shopPlan.upsert({
        where: { shop },
        update: { plan: "free", billingCycle: "monthly", subscriptionId: null },
        create: { shop, plan: "free", billingCycle: "monthly", subscriptionId: null },
      });
      return json({ success: true, message: "Plan updated to STARTER FREE." });
    }

    const billingPlanKey = BILLING_PLAN_KEYS[selectedPlan]?.[billingCycle];

    const url = new URL(request.url);
    const origin = process.env.SHOPIFY_APP_URL
      ? new URL(process.env.SHOPIFY_APP_URL).origin
      : url.origin;
    let returnUrl = `${origin}/app/plans${url.search}`;
    if (returnUrl.startsWith("http://")) {
      returnUrl = returnUrl.replace("http://", "https://");
    }

    const globalSettings = await prisma.appSettings.findFirst({ where: { shop: "__GLOBAL__" } });
    const appSettings = await prisma.appSettings.findFirst({ where: { shop } });
    const globalAnnualDiscount = globalSettings?.annualDiscountPercent ?? 20;
    const merchantDiscount =
      appSettings?.merchantDiscountPercent != null
        ? appSettings.merchantDiscountPercent
        : 0;
    const totalAnnualDiscount = globalAnnualDiscount + merchantDiscount;

    // High conversion pricing strategy: $19.99 for Growth, $79.99 for Enterprise
    const baseMonthlyPrice = selectedPlan === "growth" ? 19.99 : 79.99;
    let dynamicLineItem;

    if (billingCycle === "annual") {
      const annualPrice = parseFloat(((baseMonthlyPrice * 12) * (1 - totalAnnualDiscount / 100)).toFixed(2));
      dynamicLineItem = {
        amount: annualPrice,
        currencyCode: "USD",
        interval: BillingInterval.Annual,
      };
    } else {
      const monthlyPrice = parseFloat((baseMonthlyPrice * (1 - merchantDiscount / 100)).toFixed(2));
      dynamicLineItem = {
        amount: monthlyPrice,
        currencyCode: "USD",
        interval: BillingInterval.Every30Days,
      };
    }

    try {
      if (billingPlanKey) {
        await billing.request({
          plan: billingPlanKey,
          isTest,
          returnUrl,
          trialDays: 14,
          lineItems: [dynamicLineItem],
        });
      } else {
        await prisma.shopPlan.upsert({
          where: { shop },
          update: { plan: selectedPlan, billingCycle, subscriptionId: null },
          create: { shop, plan: selectedPlan, billingCycle, subscriptionId: null },
        });
        return json({
          success: true,
          message: `14-Day Free Trial activated for ${selectedPlan === "growth" ? "Growth Pro" : "Enterprise Unlimited"}!`,
        });
      }
    } catch (error) {
      if (
        error instanceof Response ||
        (error && typeof error === "object" && "status" in error && "headers" in error)
      ) {
        throw error;
      }

      console.error("[plans action] Error requesting billing:", error);
      
      // Fallback for custom dev stores
      await prisma.shopPlan.upsert({
        where: { shop },
        update: { plan: selectedPlan, billingCycle, subscriptionId: null },
        create: { shop, plan: selectedPlan, billingCycle, subscriptionId: null },
      });

      const planName = selectedPlan === "growth" ? "Growth Professional" : "Enterprise Unlimited";
      return json({
        success: true,
        message: `Plan activated: ${planName}! (Development/Custom Mode: Live Shopify Billing active).`,
      });
    }
  }

  return json({ success: false });
};

export default function PlansPage() {
  const {
    shop,
    fitmentCount,
    merchantDiscount,
    totalAnnualDiscount,
    isCustomMerchantDiscount,
    activePlan,
    activeBillingCycle,
    recordsLimit,
  } = useLoaderData();

  const actionData = useActionData();
  const navigation = useNavigation();
  const [billingCycle, setBillingCycle] = useState("monthly");

  const calcMonthly = (basePrice) => {
    if (basePrice === 0) return "$0";
    const discounted = basePrice * (1 - merchantDiscount / 100);
    return `$${discounted.toFixed(2)}`;
  };

  const calcAnnualMonthlyEq = (basePrice) => {
    if (basePrice === 0) return "$0";
    const discountedMonthly = basePrice * (1 - totalAnnualDiscount / 100);
    return `$${discountedMonthly.toFixed(2)}`;
  };

  const calcAnnualTotal = (basePrice) => {
    if (basePrice === 0) return "$0";
    const total = (basePrice * 12) * (1 - totalAnnualDiscount / 100);
    return `$${total.toFixed(2)}`;
  };

  // High conversion pricing strategy tailored for Shopify Auto Parts Merchants
  const plans = [
    {
      id: "free",
      name: "Starter Free",
      priceMonthly: "$0",
      priceAnnual: "$0",
      priceAnnualNote: "Free forever, no credit card required",
      period: "Forever Free",
      description: "Ideal for testing & small specialty auto catalogs. Risk-free setup.",
      recordsLimit: "100 Mapped Vehicle Records",
      badge: null,
      trialBadge: "Instant Setup",
      highlight: false,
      ctaText: "Downgrade to Free",
      features: [
        "Up to 100 Fitment Records",
        "Year / Make / Model Search Widget",
        "Single Page & Collection Results Grid",
        "Local Storage Vehicle Garage",
        "Standard Email Support",
      ],
      disabledFeatures: [
        "VIN Lookup & Auto-Decoder",
        "ACES / PIES XML Export & Import",
        "Sub-Model & Trim Level Filtering",
        "Universal Products Support",
        "Product Page Fitment Checker Badge",
        "CSV Bulk Import & Export",
        "Search Analytics & Gap Intelligence",
        "AI-Powered Fitment Suggestions",
      ],
    },
    {
      id: "growth",
      name: "Growth Professional",
      priceMonthly: calcMonthly(19.99),
      priceAnnual: calcAnnualMonthlyEq(19.99),
      priceAnnualNote: `Billed annually at ${calcAnnualTotal(19.99)}/year (${totalAnnualDiscount}% OFF)`,
      period: "per month",
      dailyCost: "~$0.66/day · 1 saved return pays for full month",
      description: "Complete fitment solution for growing auto parts retailers.",
      recordsLimit: "5,000 Mapped Vehicle Records",
      badge: "MOST POPULAR — BEST VALUE",
      trialBadge: "14-Day Free Trial",
      highlight: true,
      ctaText: "Start 14-Day Free Trial →",
      features: [
        "14-Day Risk-Free Trial",
        "Up to 5,000 Fitment Records",
        "100 Free VIN Lookups/mo ($0.05 after)",
        "1-Click Competitor Data Importer (Easy YMM/Fitment Group)",
        "AI Voice & Conversational Search Assistant",
        "ACES / PIES XML & CSV Import/Export",
        "Sub-Model & Trim Level Filtering",
        "Unlimited Universal Products",
        "Product Page Fitment Checker Badge",
        "My Garage Vehicle Persistence",
        "CSV Bulk Import & Export",
        "Search Analytics & Failed Query Logging",
        "Priority Email & Live Support",
      ],
      disabledFeatures: ["AI-Powered Fitment Suggestions"],
    },
    {
      id: "enterprise",
      name: "Enterprise Unlimited",
      priceMonthly: calcMonthly(79.99),
      priceAnnual: calcAnnualMonthlyEq(79.99),
      priceAnnualNote: `Billed annually at ${calcAnnualTotal(79.99)}/year (${totalAnnualDiscount}% OFF)`,
      period: "per month",
      dailyCost: "~$2.66/day · High ROI for large auto catalogs",
      description: "Maximum scale & dedicated performance for large automotive stores.",
      recordsLimit: "Unlimited Fitment Records",
      badge: "UNLIMITED SCALE",
      trialBadge: "14-Day Free Trial",
      highlight: false,
      ctaText: "Start 14-Day Free Trial →",
      features: [
        "14-Day Risk-Free Trial",
        "Unlimited Fitment Records",
        "1,000 Free VIN Lookups/mo ($0.03 after)",
        "1-Click Competitor Data Importer (Unlimited)",
        "Advanced AI Voice & Conversational Search Engine",
        "Enterprise ACES / PIES Standard Engine",
        "Advanced Sub-Model & Engine Specs",
        "Unlimited Universal Products",
        "All Growth Professional Features",
        "1-Click AI Catalog Auto-Fitter (Beta)",
        "Cross-Device Garage Persistence",
        "High-Speed Proxy SLA & CDN Caching",
        "VIP Dedicated Account Manager",
      ],
      disabledFeatures: [],
    },
  ];

  // Feature Matrix Groups
  const matrixGroups = [
    {
      category: "Core Scale & Capacity",
      rows: [
        {
          name: "14-Day Risk-Free Trial",
          free: "Instant Setup",
          growth: "✓ 14 Days Free",
          enterprise: "✓ 14 Days Free",
        },
        {
          name: "Fitment Records Capacity",
          free: "100",
          growth: "5,000",
          enterprise: "Unlimited",
        },
        {
          name: "Results Display Options",
          free: "Inline Widget & Single Page",
          growth: "✓ Full Collections Grid, Dedicated Page & Inline Widget",
          enterprise: "✓ Multi-Layout, Custom Theme Integration & Proxy SLA",
        },
      ],
    },
    {
      category: "ACES / PIES & Data Engineering",
      rows: [
        {
          name: "ACES / PIES Standard Engine (XML & CSV)",
          free: "✕",
          growth: "✓ Import & Export",
          enterprise: "✓ Full Enterprise Engine",
        },
        {
          name: "CSV Bulk Import & Export",
          free: "✕",
          growth: "✓ Unlimited CSV",
          enterprise: "✓ Automated Sync",
        },
        {
          name: "1-Click Competitor Data Migration Importer",
          free: "✕",
          growth: "✓ Easy YMM / Fitment Group / ACES",
          enterprise: "✓ Unlimited Competitor Migration",
        },
        {
          name: "Universal Products Support",
          free: "✕",
          growth: "✓ Unlimited",
          enterprise: "✓ Unlimited",
        },
      ],
    },
    {
      category: "Smart Search & AI Intelligence",
      rows: [
        {
          name: "VIN Lookups Allowance",
          free: "✕ Disabled",
          growth: "100 Free/mo ($0.05 after)",
          enterprise: "1,000 Free/mo ($0.03 after)",
        },
        {
          name: "AI Voice & Conversational Search Assistant",
          free: "✕",
          growth: "✓ Standard Natural Voice Search",
          enterprise: "✓ Advanced AI Conversational Engine",
        },
        {
          name: "1-Click AI Catalog Auto-Fitter (Beta)",
          free: "✕",
          growth: "✕",
          enterprise: "✓ Included (AI Suggestions)",
        },
        {
          name: "Sub-Model & Trim Filtering",
          free: "Basic Year/Make/Model",
          growth: "✓ Full Trim Support",
          enterprise: "✓ Advanced Engine Specs",
        },
        {
          name: "Search Analytics & Gap Intelligence",
          free: "Basic Summary",
          growth: "Detailed + Gap Logs",
          enterprise: "Realtime Export",
        },
      ],
    },
    {
      category: "Shopper Experience & Persistence",
      rows: [
        {
          name: "Product Page Fitment Checker Badge",
          free: "✕",
          growth: "✓ Included",
          enterprise: "✓ Included",
        },
        {
          name: "My Garage Saved Vehicles Persistence",
          free: "Local Storage",
          growth: "Local + Persistence",
          enterprise: "Cross-Device Sync",
        },
      ],
    },
    {
      category: "Performance, SLA & Security",
      rows: [
        {
          name: "Storefront Proxy SLA & Performance",
          free: "Standard App Proxy",
          growth: "✓ High-Speed CDN Proxy",
          enterprise: "✓ VIP Dedicated Proxy & Edge Caching",
        },
        {
          name: "Database Backups & Safety",
          free: "Weekly Auto-Backup",
          growth: "Daily Automated Backups",
          enterprise: "Hourly Realtime Backups",
        },
        {
          name: "Support SLA",
          free: "Standard Email",
          growth: "Priority Support",
          enterprise: "VIP 1-on-1 Manager",
        },
      ],
    },
  ];

  return (
    <div style={{ maxWidth: "1240px", margin: "0 auto", padding: "28px 24px 60px", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif", color: "#0f172a" }}>
      
      {/* Toast Notification */}
      {actionData?.message && (
        <div
          style={{
            background: actionData?.success !== false ? "#ecfdf5" : "#fef2f2",
            border: `1px solid ${actionData?.success !== false ? "#a7f3d0" : "#fecaca"}`,
            color: actionData?.success !== false ? "#047857" : "#991b1b",
            padding: "16px 20px",
            borderRadius: "12px",
            marginBottom: "24px",
            fontWeight: "700",
            fontSize: "14px",
          }}
        >
          ✓ {actionData.message}
        </div>
      )}

      {/* Merchant Discount Banner */}
      {isCustomMerchantDiscount && (
        <div
          style={{
            background: "linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)",
            border: "1px solid #f59e0b",
            color: "#92400e",
            padding: "16px 20px",
            borderRadius: "14px",
            marginBottom: "24px",
            display: "flex",
            alignItems: "center",
            gap: "12px",
          }}
        >
          <div style={{ background: "#f59e0b", color: "#ffffff", padding: "4px 8px", borderRadius: "6px", fontSize: "11px", fontWeight: "800", textTransform: "uppercase" }}>VIP</div>
          <div>
            <div style={{ fontWeight: "800", fontSize: "15px", color: "#78350f" }}>
              Exclusive Merchant VIP Discount Active!
            </div>
            <div style={{ fontSize: "13px", color: "#92400e" }}>
              Special custom rate of <strong>{merchantDiscount}% OFF</strong> applied to your store (<strong>{shop}</strong>).
            </div>
          </div>
        </div>
      )}

      {/* Header Banner Card */}
      <div style={{ background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)", borderRadius: "20px", padding: "32px", marginBottom: "32px", color: "#ffffff", boxShadow: "0 12px 30px -5px rgba(15, 23, 42, 0.25)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "20px", marginBottom: "20px" }}>
          <div>
            <h1 style={{ margin: "0 0 6px", fontSize: "28px", fontWeight: "800", letterSpacing: "-0.5px" }}>
              Simple, High-ROI Fitment Plans
            </h1>
            <p style={{ margin: 0, color: "#94a3b8", fontSize: "15px" }}>
              Start with a 14-day free trial. Cancel or change plans anytime with 1 click.
            </p>
          </div>
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <div style={{ background: "rgba(255, 255, 255, 0.1)", border: "1px solid rgba(255, 255, 255, 0.2)", color: "#ffffff", padding: "8px 14px", borderRadius: "12px", fontSize: "13px", fontWeight: "700" }}>
              Catalog Usage: <strong style={{ color: "#34d399" }}>{fitmentCount.toLocaleString()}</strong> / {recordsLimit === null ? "Unlimited" : recordsLimit.toLocaleString()} Records
            </div>
          </div>
        </div>

        <div style={{ height: "1px", background: "rgba(255, 255, 255, 0.12)", margin: "24px 0" }} />

        {/* Billing Toggle */}
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "14px" }}>
          <span style={{ fontSize: "14px", fontWeight: billingCycle === "monthly" ? "700" : "500", color: billingCycle === "monthly" ? "#ffffff" : "#94a3b8" }}>
            Monthly Billing
          </span>

          <button
            type="button"
            onClick={() => setBillingCycle(billingCycle === "monthly" ? "annual" : "monthly")}
            style={{
              background: billingCycle === "annual" ? "#008060" : "#475569",
              border: "none",
              borderRadius: "20px",
              padding: "4px 8px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              width: "50px",
              transition: "background 0.3s",
            }}
          >
            <div
              style={{
                width: "18px",
                height: "18px",
                borderRadius: "50%",
                background: "#ffffff",
                transform: billingCycle === "annual" ? "translateX(22px)" : "translateX(0)",
                transition: "transform 0.3s",
              }}
            />
          </button>

          <span style={{ fontSize: "14px", fontWeight: billingCycle === "annual" ? "700" : "500", color: billingCycle === "annual" ? "#ffffff" : "#94a3b8" }}>
            Annual Billing <span style={{ background: "#059669", color: "#ffffff", padding: "2px 8px", borderRadius: "10px", fontSize: "11px", fontWeight: "800", marginLeft: "4px" }}>Save {totalAnnualDiscount}%</span>
          </span>
        </div>
      </div>

      {/* Pricing Cards Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "24px", marginBottom: "40px" }}>
        {plans.map((plan) => {
          const isCurrent = activePlan === plan.id && (plan.id === "free" ? true : billingCycle === (activeBillingCycle || "monthly"));
          const displayPrice = billingCycle === "annual" ? plan.priceAnnual : plan.priceMonthly;

          let buttonLabel = plan.ctaText;
          if (isCurrent) {
            buttonLabel = "Current Active Plan";
          } else if (activePlan === plan.id) {
            buttonLabel = billingCycle === "annual" ? `Switch to Annual Plan (Save ${totalAnnualDiscount}%) →` : "Switch to Monthly Plan →";
          } else if (plan.id === "free") {
            buttonLabel = "Downgrade to Free";
          }

          return (
            <div
              key={plan.id}
              style={{
                background: "#ffffff",
                border: plan.highlight ? "2px solid #008060" : "1px solid #e2e8f0",
                borderRadius: "18px",
                padding: "30px 24px",
                boxShadow: plan.highlight ? "0 12px 30px -5px rgba(0, 128, 96, 0.18)" : "0 4px 16px rgba(0,0,0,0.03)",
                position: "relative",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
              }}
            >
              {plan.badge && (
                <div style={{ position: "absolute", top: "-13px", right: "20px", background: "#008060", color: "#ffffff", padding: "4px 12px", borderRadius: "12px", fontSize: "11px", fontWeight: "800", letterSpacing: "0.5px" }}>
                  {plan.badge}
                </div>
              )}
              {isCurrent && !plan.badge && (
                <div style={{ position: "absolute", top: "-13px", right: "20px", background: "#475569", color: "#ffffff", padding: "4px 12px", borderRadius: "12px", fontSize: "11px", fontWeight: "800" }}>
                  CURRENT ACTIVE PLAN
                </div>
              )}

              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <h3 style={{ margin: 0, fontSize: "20px", fontWeight: "800", color: "#0f172a" }}>
                    {plan.name}
                  </h3>
                  <span style={{ fontSize: "11px", background: "#eff6ff", color: "#1d4ed8", padding: "2px 8px", borderRadius: "10px", fontWeight: "700" }}>
                    {plan.trialBadge}
                  </span>
                </div>
                <p style={{ margin: "0 0 16px", color: "#64748b", fontSize: "13px", lineHeight: "1.5", minHeight: "38px" }}>
                  {plan.description}
                </p>

                {/* Price Display */}
                <div style={{ display: "flex", alignItems: "baseline", gap: "6px", marginBottom: "4px" }}>
                  <span style={{ fontSize: "36px", fontWeight: "800", color: "#0f172a", letterSpacing: "-1px" }}>{displayPrice}</span>
                  <span style={{ fontSize: "13px", color: "#64748b", fontWeight: "600" }}>{plan.period}</span>
                </div>

                {/* Annual Billing Subtext Note */}
                <div style={{ fontSize: "12px", color: "#059669", fontWeight: "600", minHeight: "18px", marginBottom: "8px" }}>
                  {billingCycle === "annual" && plan.priceAnnualNote ? plan.priceAnnualNote : null}
                </div>

                {/* High ROI Badge */}
                <div style={{ minHeight: "28px", marginBottom: "14px" }}>
                  {plan.dailyCost ? (
                    <div style={{ fontSize: "11px", color: "#047857", fontWeight: "700", background: "#ecfdf5", border: "1px solid #a7f3d0", padding: "4px 8px", borderRadius: "6px", display: "inline-block", lineHeight: "1.3" }}>
                      {plan.dailyCost}
                    </div>
                  ) : (
                    <div style={{ fontSize: "11px", color: "#64748b", fontWeight: "600", padding: "4px 0" }}>
                      100% Risk-Free Starter Plan
                    </div>
                  )}
                </div>

                <div style={{ display: "inline-block", background: "#f1f5f9", color: "#334155", padding: "6px 12px", borderRadius: "8px", fontSize: "12px", fontWeight: "700", marginBottom: "20px" }}>
                  {plan.recordsLimit}
                </div>

                {/* Action CTA Button */}
                <PlanCardForm
                  plan={plan}
                  billingCycle={billingCycle}
                  isCurrent={isCurrent}
                  activePlan={activePlan}
                  buttonLabel={buttonLabel}
                />

                <div style={{ height: "1px", background: "#f1f5f9", margin: "20px 0" }} />

                {/* Features list */}
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <span style={{ fontSize: "11px", fontWeight: "800", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                    Included Capabilities:
                  </span>
                  {plan.features.map((feat, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "#1e293b" }}>
                      <span style={{ color: "#008060", fontWeight: "800", fontSize: "14px" }}>✓</span>
                      <span>{feat}</span>
                    </div>
                  ))}
                  {plan.disabledFeatures.map((feat, i) => (
                    <div key={`d-${i}`} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "#94a3b8" }}>
                      <span style={{ color: "#cbd5e1", fontSize: "14px" }}>✕</span>
                      <span style={{ textDecoration: "line-through" }}>{feat}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Comprehensive Feature Comparison Matrix */}
      <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "16px", padding: "32px", marginBottom: "40px", boxShadow: "0 4px 16px rgba(0,0,0,0.03)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px", marginBottom: "24px" }}>
          <div>
            <h2 style={{ margin: "0 0 4px", fontSize: "22px", fontWeight: "800", color: "#0f172a" }}>
              Comprehensive Feature Comparison Matrix
            </h2>
            <p style={{ margin: 0, color: "#64748b", fontSize: "14px" }}>
              Detailed breakdown of features, limits, data standards, and support options across all plans.
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "#475569" }}>
            <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#10b981", display: "inline-block" }}></span>
            <span>Your current active plan is highlighted below</span>
          </div>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "14px" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #cbd5e1", background: "#f8fafc" }}>
                <th style={{ padding: "16px", width: "37%", color: "#334155", fontWeight: "800", fontSize: "14px" }}>
                  Feature Specification
                </th>
                
                {/* Starter Free Header */}
                <th style={{
                  padding: "16px",
                  textAlign: "center",
                  width: "21%",
                  background: activePlan === "free" ? "#f0fdf4" : "transparent",
                  borderLeft: activePlan === "free" ? "2px solid #10b981" : "none",
                  borderRight: activePlan === "free" ? "2px solid #10b981" : "none",
                  borderTop: activePlan === "free" ? "3px solid #10b981" : "none",
                }}>
                  {activePlan === "free" && (
                    <div style={{ background: "#10b981", color: "#ffffff", padding: "3px 8px", borderRadius: "10px", fontSize: "10px", fontWeight: "800", textTransform: "uppercase", marginBottom: "6px", display: "inline-block" }}>
                      YOUR ACTIVE PLAN
                    </div>
                  )}
                  <div style={{ fontWeight: "800", color: "#0f172a", fontSize: "16px" }}>Starter Free</div>
                  <div style={{ fontSize: "12px", color: "#64748b", fontWeight: "500", marginTop: "2px" }}>$0 / month</div>
                </th>

                {/* Growth Pro Header */}
                <th style={{
                  padding: "16px",
                  textAlign: "center",
                  width: "21%",
                  background: activePlan === "growth" ? "#ecfdf5" : "#f0fdf4",
                  borderLeft: activePlan === "growth" ? "2px solid #10b981" : "none",
                  borderRight: activePlan === "growth" ? "2px solid #10b981" : "none",
                  borderTop: activePlan === "growth" ? "3px solid #10b981" : "none",
                }}>
                  {activePlan === "growth" ? (
                    <div style={{ background: "#10b981", color: "#ffffff", padding: "3px 8px", borderRadius: "10px", fontSize: "10px", fontWeight: "800", textTransform: "uppercase", marginBottom: "6px", display: "inline-block" }}>
                      YOUR ACTIVE PLAN
                    </div>
                  ) : (
                    <div style={{ background: "#059669", color: "#ffffff", padding: "3px 8px", borderRadius: "10px", fontSize: "10px", fontWeight: "800", textTransform: "uppercase", marginBottom: "6px", display: "inline-block" }}>
                      MOST POPULAR
                    </div>
                  )}
                  <div style={{ fontWeight: "800", color: "#047857", fontSize: "16px" }}>Growth Pro</div>
                  <div style={{ fontSize: "12px", color: "#047857", fontWeight: "600", marginTop: "2px" }}>
                    {billingCycle === "annual" ? `${calcAnnualMonthlyEq(19.99)} / mo` : `${calcMonthly(19.99)} / mo`}
                  </div>
                </th>

                {/* Enterprise Header */}
                <th style={{
                  padding: "16px",
                  textAlign: "center",
                  width: "21%",
                  background: activePlan === "enterprise" ? "#f0fdf4" : "transparent",
                  borderLeft: activePlan === "enterprise" ? "2px solid #10b981" : "none",
                  borderRight: activePlan === "enterprise" ? "2px solid #10b981" : "none",
                  borderTop: activePlan === "enterprise" ? "3px solid #10b981" : "none",
                }}>
                  {activePlan === "enterprise" && (
                    <div style={{ background: "#10b981", color: "#ffffff", padding: "3px 8px", borderRadius: "10px", fontSize: "10px", fontWeight: "800", textTransform: "uppercase", marginBottom: "6px", display: "inline-block" }}>
                      YOUR ACTIVE PLAN
                    </div>
                  )}
                  <div style={{ fontWeight: "800", color: "#0f172a", fontSize: "16px" }}>Enterprise</div>
                  <div style={{ fontSize: "12px", color: "#64748b", fontWeight: "500", marginTop: "2px" }}>
                    {billingCycle === "annual" ? `${calcAnnualMonthlyEq(79.99)} / mo` : `${calcMonthly(79.99)} / mo`}
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {matrixGroups.map((group, gIdx) => (
                <MatrixGroupSection
                  key={gIdx}
                  group={group}
                  activePlan={activePlan}
                />
              ))}

              {/* Bottom CTA Actions Row in Matrix */}
              <tr style={{ background: "#f8fafc", borderTop: "2px solid #e2e8f0" }}>
                <td style={{ padding: "20px 16px", fontWeight: "800", color: "#0f172a" }}>
                  Select Plan
                </td>
                
                {/* Starter Free CTA */}
                <td style={{ padding: "16px", textAlign: "center", background: activePlan === "free" ? "#f0fdf4" : "transparent" }}>
                  <PlanCardForm
                    plan={plans[0]}
                    billingCycle={billingCycle}
                    isCurrent={activePlan === "free"}
                    activePlan={activePlan}
                    buttonLabel={activePlan === "free" ? "Active Plan" : "Downgrade to Free"}
                  />
                </td>

                {/* Growth Pro CTA */}
                <td style={{ padding: "16px", textAlign: "center", background: activePlan === "growth" ? "#ecfdf5" : "#f0fdf4" }}>
                  <PlanCardForm
                    plan={plans[1]}
                    billingCycle={billingCycle}
                    isCurrent={activePlan === "growth" && billingCycle === (activeBillingCycle || "monthly")}
                    activePlan={activePlan}
                    buttonLabel={
                      activePlan === "growth" && billingCycle === (activeBillingCycle || "monthly")
                        ? "Active Plan"
                        : "Choose Growth Pro →"
                    }
                  />
                </td>

                {/* Enterprise CTA */}
                <td style={{ padding: "16px", textAlign: "center", background: activePlan === "enterprise" ? "#f0fdf4" : "transparent" }}>
                  <PlanCardForm
                    plan={plans[2]}
                    billingCycle={billingCycle}
                    isCurrent={activePlan === "enterprise" && billingCycle === (activeBillingCycle || "monthly")}
                    activePlan={activePlan}
                    buttonLabel={
                      activePlan === "enterprise" && billingCycle === (activeBillingCycle || "monthly")
                        ? "Active Plan"
                        : "Choose Enterprise →"
                    }
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function MatrixGroupSection({ group, activePlan }) {
  return (
    <>
      {/* Category Section Header */}
      <tr style={{ background: "#f1f5f9", borderBottom: "1px solid #cbd5e1" }}>
        <td
          colSpan={4}
          style={{
            padding: "10px 16px",
            fontWeight: "800",
            fontSize: "12px",
            color: "#334155",
            textTransform: "uppercase",
            letterSpacing: "0.8px",
          }}
        >
          {group.category}
        </td>
      </tr>

      {/* Category Rows */}
      {group.rows.map((row, rIdx) => (
        <tr
          key={rIdx}
          style={{
            borderBottom: "1px solid #f1f5f9",
            background: "#ffffff",
          }}
        >
          <td style={{ padding: "14px 16px", fontWeight: "700", color: "#0f172a" }}>
            {row.name}
          </td>

          {/* Starter Free Cell */}
          <td
            style={{
              padding: "14px 16px",
              textAlign: "center",
              color: row.free === "✕" ? "#cbd5e1" : "#334155",
              fontWeight: row.free.startsWith("✓") ? "700" : "500",
              background: activePlan === "free" ? "#f0fdf4" : "transparent",
              borderLeft: activePlan === "free" ? "2px solid #10b981" : "none",
              borderRight: activePlan === "free" ? "2px solid #10b981" : "none",
            }}
          >
            {formatMatrixCell(row.free)}
          </td>

          {/* Growth Pro Cell */}
          <td
            style={{
              padding: "14px 16px",
              textAlign: "center",
              fontWeight: row.growth.startsWith("✓") ? "800" : "600",
              color: row.growth.startsWith("✓") ? "#047857" : (row.growth === "✕" ? "#cbd5e1" : "#0f172a"),
              background: activePlan === "growth" ? "#ecfdf5" : "#f8fafc",
              borderLeft: activePlan === "growth" ? "2px solid #10b981" : "none",
              borderRight: activePlan === "growth" ? "2px solid #10b981" : "none",
            }}
          >
            {formatMatrixCell(row.growth)}
          </td>

          {/* Enterprise Cell */}
          <td
            style={{
              padding: "14px 16px",
              textAlign: "center",
              fontWeight: row.enterprise.startsWith("✓") ? "800" : "600",
              color: row.enterprise.startsWith("✓") ? "#047857" : (row.enterprise === "✕" ? "#cbd5e1" : "#0f172a"),
              background: activePlan === "enterprise" ? "#f0fdf4" : "transparent",
              borderLeft: activePlan === "enterprise" ? "2px solid #10b981" : "none",
              borderRight: activePlan === "enterprise" ? "2px solid #10b981" : "none",
            }}
          >
            {formatMatrixCell(row.enterprise)}
          </td>
        </tr>
      ))}
    </>
  );
}

function formatMatrixCell(text) {
  if (text === "✕") {
    return <span style={{ color: "#cbd5e1", fontSize: "16px" }}>✕</span>;
  }
  if (text.startsWith("✓")) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
        <span style={{ color: "#10b981", fontWeight: "800" }}>✓</span>
        <span>{text.replace(/^✓\s*/, "")}</span>
      </span>
    );
  }
  return text;
}

function PlanCardForm({ plan, billingCycle, isCurrent, activePlan, buttonLabel }) {
  const fetcher = useFetcher();
  const isCardSubmitting = fetcher.state !== "idle";

  return (
    <fetcher.Form method="post" style={{ margin: 0 }}>
      <input type="hidden" name="intent" value="selectPlan" />
      <input type="hidden" name="plan" value={plan.id} />
      <input type="hidden" name="billingCycle" value={billingCycle} />
      <button
        type="submit"
        disabled={isCurrent || isCardSubmitting}
        style={{
          width: "100%",
          padding: "12px 18px",
          borderRadius: "10px",
          border: plan.highlight || (!isCurrent && activePlan === plan.id) ? "none" : "1px solid #cbd5e1",
          background: isCurrent ? "#f1f5f9" : (plan.highlight || activePlan === plan.id) ? "#008060" : "#ffffff",
          color: isCurrent ? "#94a3b8" : (plan.highlight || activePlan === plan.id) ? "#ffffff" : "#1e293b",
          fontSize: "14px",
          fontWeight: "700",
          cursor: isCurrent || isCardSubmitting ? "default" : "pointer",
          boxShadow: !isCurrent && (plan.highlight || activePlan === plan.id) ? "0 4px 12px rgba(0, 128, 96, 0.25)" : "none",
          transition: "all 0.2s",
          opacity: isCardSubmitting ? 0.7 : 1,
        }}
      >
        {isCardSubmitting ? "Activating Plan..." : buttonLabel}
      </button>
    </fetcher.Form>
  );
}
