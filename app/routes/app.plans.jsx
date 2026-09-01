const json = (data, init) => Response.json(data, init);
import { useState } from "react";
import { useLoaderData, useActionData, useNavigation, Form } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { BillingInterval } from "@shopify/shopify-app-react-router/server";
import { BILLING_PLAN_KEYS, getIsTestCharge, isTestCharge, planLimits } from "../plans.config";
import { syncShopPlanFromBilling } from "../plans.server";

export const loader = async ({ request }) => {
  const { session, billing } = await authenticate.admin(request);
  const shop = session.shop;

  // eslint-disable-next-line no-undef
  const adminEmail = "sandeepptpss@gmail.com";
  // eslint-disable-next-line no-undef
  const adminStore = "quickstart-749ac396";

  const sessionEmail = session.email || adminEmail;
  const shopDomain = (shop || "").toLowerCase();
  const userEmail = (sessionEmail || "").toLowerCase();

  // Admin verification
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

  return {
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
    billingCycle: shopPlan.billingCycle,
    recordsLimit: Number.isFinite(limits.fitmentLimit) ? limits.fitmentLimit : null,
    vinLimit: limits.vinMonthlyLimit,
    vinOverageRate: limits.vinOverageRate,
  };
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
        console.warn("[plans action] Error cancelling existing subscription:", err);
      }
      await prisma.shopPlan.upsert({
        where: { shop },
        update: { plan: "free", billingCycle: "monthly", subscriptionId: null },
        create: { shop, plan: "free", billingCycle: "monthly", subscriptionId: null },
      });
      return json({ success: true, message: "Plan successfully updated to STARTER FREE!" });
    }

    const billingPlanKey = BILLING_PLAN_KEYS[selectedPlan]?.[billingCycle];
    if (!billingPlanKey) {
      return json({ success: false, message: "Invalid plan selection." }, { status: 400 });
    }

    const url = new URL(request.url);
    const origin = process.env.SHOPIFY_APP_URL
      ? new URL(process.env.SHOPIFY_APP_URL).origin
      : url.origin;
    let returnUrl = `${origin}/app/plans${url.search}`;
    if (returnUrl.startsWith("http://")) {
      returnUrl = returnUrl.replace("http://", "https://");
    }

    // Dynamic Combined Discount Calculation for Shopify Billing Charge
    const globalSettings = await prisma.appSettings.findFirst({ where: { shop: "__GLOBAL__" } });
    const appSettings = await prisma.appSettings.findFirst({ where: { shop } });
    const globalAnnualDiscount = globalSettings?.annualDiscountPercent ?? 20;
    const merchantDiscount =
      appSettings?.merchantDiscountPercent != null
        ? appSettings.merchantDiscountPercent
        : appSettings?.annualDiscountPercent != null && appSettings.annualDiscountPercent !== globalAnnualDiscount
        ? appSettings.annualDiscountPercent
        : 0;
    const totalAnnualDiscount = globalAnnualDiscount + merchantDiscount;

    const baseMonthlyPrice = selectedPlan === "growth" ? 19.99 : 49.99;
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
      await billing.request({
        plan: billingPlanKey,
        isTest,
        returnUrl,
        lineItems: [dynamicLineItem],
      });
    } catch (error) {
      if (
        error instanceof Response ||
        (error && typeof error === "object" && "status" in error && "headers" in error)
      ) {
        throw error;
      }

      console.error("[plans action] Error requesting billing:", error);
      const detail =
        error?.errorData?.[0]?.message ||
        error?.message ||
        "Error requesting billing subscription.";

      if (detail.includes("public distribution") || detail.includes("cannot use the Billing API")) {
        await prisma.shopPlan.upsert({
          where: { shop },
          update: { plan: selectedPlan, billingCycle, subscriptionId: null },
          create: { shop, plan: selectedPlan, billingCycle, subscriptionId: null },
        });

        const planName = selectedPlan === "growth" ? "Growth Professional" : "Enterprise Unlimited";
        return json({
          success: true,
          message: `Plan activated: ${planName}! (Development/Custom App Mode: Live Shopify Billing requires setting Public Distribution in Partner Dashboard).`,
        });
      }

      return json(
        {
          success: false,
          message: `Billing Error: ${detail}`,
        },
        { status: 400 }
      );
    }
  }

  return json({ success: false });
};

export default function PlansPage() {
  const {
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
    activePlan,
    recordsLimit,
    vinLimit,
    vinOverageRate,
  } = useLoaderData();

  const actionData = useActionData();
  const navigation = useNavigation();
  const [billingCycle, setBillingCycle] = useState("monthly"); // "monthly" | "annual"

  const isSubmitting = navigation.state !== "idle";

  // Monthly price: Applies Merchant VIP discount if any
  const calcMonthly = (basePrice) => {
    if (basePrice === 0) return "$0";
    const discounted = basePrice * (1 - merchantDiscount / 100);
    return `$${discounted.toFixed(2)}`;
  };

  // Annual price: Applies BOTH Annual Discount + Merchant VIP discount combined!
  const calcAnnual = (basePrice) => {
    if (basePrice === 0) return "$0";
    const discounted = basePrice * (1 - totalAnnualDiscount / 100);
    return `$${discounted.toFixed(2)}`;
  };

  const plans = [
    {
      id: "free",
      name: "Starter Free",
      priceMonthly: "$0",
      priceAnnual: "$0",
      period: "Forever Free",
      description: "Essential vehicle fitment search for testing and small auto part catalogs.",
      recordsLimit: "100 Fitment Records",
      badge: null,
      highlight: false,
      features: [
        "Up to 100 Fitment Records",
        "Year / Make / Model Search Widget",
        "Single Page & Collection Results Grid",
        "Local Storage Vehicle Garage",
        "Standard Email Support",
      ],
      disabledFeatures: [
        "VIN Lookup & Auto-Decoder",
        "ACES / PIES Export & Import",
        "Sub-Model & Trim Level Filtering",
        "Universal Products Support",
        "Product Page Compatibility Badge",
        "CSV Bulk Import & Export",
        "Search Analytics & Gap Logs",
        "AI-Powered Fitment Suggestions",
      ],
    },
    {
      id: "growth",
      name: "Growth Professional",
      priceMonthly: calcMonthly(19.99),
      priceAnnual: calcAnnual(19.99),
      period: "per month",
      description: "Complete fitment solution for growing auto parts retailers.",
      recordsLimit: "5,000 Fitment Records",
      badge: "MOST POPULAR",
      highlight: true,
      features: [
        "Up to 5,000 Fitment Records",
        "100 VIN Lookups Included/mo ($0.05 extra)",
        "ACES / PIES XML & CSV Import/Export",
        "Sub-Model & Trim Level Filtering",
        "Unlimited Universal Products",
        "Native Collection & Custom Results Grid",
        "Product Page Fitment Checker Badge",
        "My Garage Vehicle Persistence",
        "CSV Bulk Import & Export",
        "Search Analytics & Failed Query Logging",
        "Priority Email & Chat Support",
      ],
      disabledFeatures: ["AI-Powered Fitment Suggestions"],
    },
    {
      id: "enterprise",
      name: "Enterprise Unlimited",
      priceMonthly: calcMonthly(49.99),
      priceAnnual: calcAnnual(49.99),
      period: "per month",
      description: "Maximum scale & dedicated performance for large automotive catalogs.",
      recordsLimit: "Unlimited Fitment Records",
      badge: "UNLIMITED",
      highlight: false,
      features: [
        "Unlimited Fitment Records",
        "Unlimited VIN Lookup Searches (No Cap)",
        "Enterprise ACES / PIES Standard Engine",
        "Advanced Sub-Model & Trim Specs",
        "Unlimited Universal Products",
        "All Growth Professional Features",
        "AI-Powered Fitment Suggestions (Beta)",
        "Server-Side Cross-Device Garage Sync",
        "High-Speed Proxy SLA & CDN Caching",
        "Daily Automated Database Backups",
        "VIP Dedicated Account Manager",
        "Custom Storefront Integration Help",
      ],
      disabledFeatures: [],
    },
  ];

  return (
    <div style={{ maxWidth: "1240px", margin: "0 auto", padding: "28px 24px", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif", color: "#202223" }}>
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
            boxShadow: "0 4px 12px rgba(0,0,0,0.04)",
          }}
        >
          {actionData?.success !== false ? "✓" : ""} {actionData.message}
        </div>
      )}

      {/* User-Specific Custom Discount Notification */}
      {isCustomMerchantDiscount && (
        <div
          style={{
            background: "linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)",
            border: "1px solid #f59e0b",
            color: "#92400e",
            padding: "18px 24px",
            borderRadius: "16px",
            marginBottom: "28px",
            boxShadow: "0 6px 18px rgba(245, 158, 11, 0.12)",
            display: "flex",
            alignItems: "center",
            gap: "14px",
          }}
        >
          <span style={{ fontSize: "28px" }}>🎁</span>
          <div>
            <div style={{ fontWeight: "800", fontSize: "16px", color: "#78350f", marginBottom: "2px" }}>
              Exclusive Merchant VIP Discount Active!
            </div>
            <div style={{ fontSize: "14px", color: "#92400e" }}>
              Admin has assigned a custom discount rate of <strong>{merchantDiscount}% OFF</strong> for store: <strong>{shop}</strong> (Monthly: {merchantDiscount}% OFF | Annual: {totalAnnualDiscount}% OFF total!).
            </div>
          </div>
        </div>
      )}

      {/* Header Banner Card */}
      <div style={{ background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)", borderRadius: "16px", padding: "32px", marginBottom: "32px", color: "#ffffff", boxShadow: "0 10px 25px -5px rgba(15, 23, 42, 0.25)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "20px", marginBottom: "24px" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
              <h1 style={{ margin: 0, fontSize: "28px", fontWeight: "800", letterSpacing: "-0.5px" }}>
                Flexible Billing & Growth Plans
              </h1>
            </div>
            <p style={{ margin: 0, color: "#94a3b8", fontSize: "15px" }}>
              Choose the right tier to scale vehicle fitment lookups and catalog capacity.
            </p>
          </div>
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
            <div style={{ background: "rgba(255, 255, 255, 0.1)", border: "1px solid rgba(255, 255, 255, 0.2)", color: "#ffffff", padding: "10px 18px", borderRadius: "14px", fontSize: "13px", fontWeight: "700", backdropFilter: "blur(4px)" }}>
              Catalog Usage: <strong style={{ color: "#34d399" }}>{fitmentCount.toLocaleString()}</strong> / {recordsLimit === null ? "Unlimited" : recordsLimit.toLocaleString()} Records
            </div>
            <div style={{ background: "rgba(255, 255, 255, 0.1)", border: "1px solid rgba(255, 255, 255, 0.2)", color: "#ffffff", padding: "10px 18px", borderRadius: "14px", fontSize: "13px", fontWeight: "700", backdropFilter: "blur(4px)" }}>
              VIN Lookups (Month): <strong style={{ color: "#60a5fa" }}>{vinLookupCount.toLocaleString()}</strong> / {vinLimit === Infinity || vinLimit === null ? "Unlimited" : vinLimit.toLocaleString()} {vinOverageRate > 0 ? `($${vinOverageRate}/extra)` : ""}
            </div>
          </div>
        </div>

        <div style={{ height: "1px", background: "rgba(255, 255, 255, 0.15)", margin: "24px 0" }} />

        {/* Monthly vs Annual Billing Toggle */}
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "16px" }}>
          <span style={{ fontSize: "15px", fontWeight: billingCycle === "monthly" ? "700" : "500", color: billingCycle === "monthly" ? "#ffffff" : "#94a3b8" }}>
            Monthly Billing {merchantDiscount > 0 && <span style={{ background: "rgba(251, 191, 36, 0.2)", color: "#fbbf24", border: "1px solid rgba(251, 191, 36, 0.4)", padding: "2px 8px", borderRadius: "10px", fontSize: "11px", fontWeight: "700", marginLeft: "4px" }}>{merchantDiscount}% OFF</span>}
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
              width: "54px",
              transition: "background 0.3s",
            }}
          >
            <div
              style={{
                width: "20px",
                height: "20px",
                borderRadius: "50%",
                background: "#ffffff",
                transform: billingCycle === "annual" ? "translateX(24px)" : "translateX(0)",
                transition: "transform 0.3s",
              }}
            />
          </button>

          <span style={{ fontSize: "15px", fontWeight: billingCycle === "annual" ? "700" : "500", color: billingCycle === "annual" ? "#ffffff" : "#94a3b8" }}>
            Annual Billing <span style={{ background: "rgba(52, 211, 153, 0.2)", color: "#34d399", border: "1px solid rgba(52, 211, 153, 0.4)", padding: "3px 10px", borderRadius: "12px", fontSize: "12px", fontWeight: "700", marginLeft: "6px" }}>Save {totalAnnualDiscount}%</span>
          </span>
        </div>
      </div>

      {/* Pricing Cards Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "24px", marginBottom: "40px" }}>
        {plans.map((plan) => {
          const isCurrent = activePlan === plan.id;
          const displayPrice = billingCycle === "annual" ? plan.priceAnnual : plan.priceMonthly;

          return (
            <div
              key={plan.id}
              style={{
                background: plan.highlight ? "#ffffff" : "#ffffff",
                border: plan.highlight ? "2px solid #008060" : "1px solid #e2e8f0",
                borderRadius: "16px",
                padding: "32px",
                boxShadow: plan.highlight ? "0 12px 30px -5px rgba(0, 128, 96, 0.18)" : "0 4px 16px rgba(0,0,0,0.03)",
                position: "relative",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
              }}
            >
              {plan.badge && (
                <div style={{ position: "absolute", top: "-14px", right: "24px", background: "#008060", color: "#ffffff", padding: "5px 14px", borderRadius: "12px", fontSize: "11px", fontWeight: "800", letterSpacing: "0.5px", boxShadow: "0 2px 6px rgba(0, 128, 96, 0.3)" }}>
                  {plan.badge}
                </div>
              )}
              {isCurrent && !plan.badge && (
                <div style={{ position: "absolute", top: "-14px", right: "24px", background: "#475569", color: "#ffffff", padding: "5px 14px", borderRadius: "12px", fontSize: "11px", fontWeight: "800" }}>
                  ACTIVE PLAN
                </div>
              )}

              <div>
                <h3 style={{ margin: "0 0 8px", fontSize: "22px", fontWeight: "800", color: "#0f172a" }}>
                  {plan.name}
                </h3>
                <p style={{ margin: "0 0 20px", color: "#64748b", fontSize: "14px", lineHeight: "1.5" }}>
                  {plan.description}
                </p>

                {/* Price Display */}
                <div style={{ display: "flex", alignItems: "baseline", gap: "6px", marginBottom: "16px" }}>
                  <span style={{ fontSize: "40px", fontWeight: "800", color: "#0f172a", letterSpacing: "-1px" }}>{displayPrice}</span>
                  <span style={{ fontSize: "14px", color: "#64748b", fontWeight: "600" }}>{plan.period}</span>
                </div>

                <div style={{ display: "inline-block", background: "#f1f5f9", color: "#334155", padding: "5px 12px", borderRadius: "8px", fontSize: "13px", fontWeight: "700", marginBottom: "24px" }}>
                  {plan.recordsLimit}
                </div>

                {/* Action Form */}
                <Form method="post" style={{ marginBottom: "28px" }}>
                  <input type="hidden" name="intent" value="selectPlan" />
                  <input type="hidden" name="plan" value={plan.id} />
                  <input type="hidden" name="billingCycle" value={billingCycle} />
                  <button
                    type="submit"
                    disabled={isCurrent || isSubmitting}
                    style={{
                      width: "100%",
                      padding: "12px 18px",
                      borderRadius: "10px",
                      border: plan.highlight ? "none" : "1px solid #cbd5e1",
                      background: isCurrent ? "#f1f5f9" : plan.highlight ? "#008060" : "#ffffff",
                      color: isCurrent ? "#94a3b8" : plan.highlight ? "#ffffff" : "#1e293b",
                      fontSize: "15px",
                      fontWeight: "700",
                      cursor: isCurrent ? "default" : "pointer",
                      boxShadow: plan.highlight && !isCurrent ? "0 4px 12px rgba(0, 128, 96, 0.25)" : "none",
                      transition: "all 0.2s",
                    }}
                  >
                    {isCurrent ? "Current Active Plan" : `Upgrade to ${plan.name}`}
                  </button>
                </Form>

                <div style={{ height: "1px", background: "#e2e8f0", margin: "24px 0" }} />

                {/* Features list */}
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <span style={{ fontSize: "12px", fontWeight: "800", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                    Included Capabilities:
                  </span>
                  {plan.features.map((feat, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "14px", color: "#1e293b" }}>
                      <span style={{ color: "#008060", fontWeight: "800", fontSize: "16px" }}>✓</span>
                      <span>{feat}</span>
                    </div>
                  ))}
                  {plan.disabledFeatures.map((feat, i) => (
                    <div key={`d-${i}`} style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "14px", color: "#94a3b8" }}>
                      <span style={{ color: "#cbd5e1", fontSize: "16px" }}>✕</span>
                      <span style={{ textDecoration: "line-through" }}>{feat}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Feature Comparison Matrix */}
      <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "16px", padding: "32px", marginBottom: "40px", boxShadow: "0 4px 16px rgba(0,0,0,0.03)" }}>
        <h2 style={{ margin: "0 0 20px", fontSize: "22px", fontWeight: "800", color: "#0f172a" }}>
          Comprehensive Feature Comparison Matrix
        </h2>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "14px" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #e2e8f0", background: "#f8fafc" }}>
                <th style={{ padding: "14px 16px", width: "40%", color: "#64748b", fontWeight: "700" }}>Feature</th>
                <th style={{ padding: "14px 16px", textAlign: "center", color: "#64748b", fontWeight: "700" }}>Starter Free</th>
                <th style={{ padding: "14px 16px", textAlign: "center", background: "#ecfdf5", color: "#047857", fontWeight: "800" }}>Growth Pro</th>
                <th style={{ padding: "14px 16px", textAlign: "center", color: "#64748b", fontWeight: "700" }}>Enterprise</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ borderBottom: "1px solid #f1f5f9" }}>
                <td style={{ padding: "14px 16px", fontWeight: "700", color: "#0f172a" }}>Fitment Records Capacity</td>
                <td style={{ padding: "14px 16px", textAlign: "center" }}>100</td>
                <td style={{ padding: "14px 16px", textAlign: "center", background: "#f8fafc", fontWeight: "800", color: "#047857" }}>5,000</td>
                <td style={{ padding: "14px 16px", textAlign: "center", fontWeight: "700" }}>Unlimited</td>
              </tr>
              <tr style={{ borderBottom: "1px solid #f1f5f9" }}>
                <td style={{ padding: "14px 16px", fontWeight: "700", color: "#0f172a" }}>VIN Lookup Quota & Overage</td>
                <td style={{ padding: "14px 16px", textAlign: "center", color: "#cbd5e1" }}>✕ Disabled</td>
                <td style={{ padding: "14px 16px", textAlign: "center", background: "#f8fafc", fontWeight: "700", color: "#047857" }}>100 / mo ($0.05/extra)</td>
                <td style={{ padding: "14px 16px", textAlign: "center", fontWeight: "700" }}>✓ Unlimited (No Cap)</td>
              </tr>
              <tr style={{ borderBottom: "1px solid #f1f5f9" }}>
                <td style={{ padding: "14px 16px", fontWeight: "700", color: "#0f172a" }}>ACES / PIES Data Standards (XML & CSV)</td>
                <td style={{ padding: "14px 16px", textAlign: "center", color: "#cbd5e1" }}>✕</td>
                <td style={{ padding: "14px 16px", textAlign: "center", background: "#f8fafc", fontWeight: "700", color: "#047857" }}>✓ Import & Export</td>
                <td style={{ padding: "14px 16px", textAlign: "center", fontWeight: "800", color: "#047857" }}>✓ Full Enterprise Engine</td>
              </tr>
              <tr style={{ borderBottom: "1px solid #f1f5f9" }}>
                <td style={{ padding: "14px 16px", fontWeight: "700", color: "#0f172a" }}>Sub-Model & Trim Filtering</td>
                <td style={{ padding: "14px 16px", textAlign: "center" }}>Basic Year/Make/Model</td>
                <td style={{ padding: "14px 16px", textAlign: "center", background: "#f8fafc", fontWeight: "700", color: "#047857" }}>✓ Full Trim Support</td>
                <td style={{ padding: "14px 16px", textAlign: "center", fontWeight: "700" }}>✓ Advanced Engine Specs</td>
              </tr>
              <tr style={{ borderBottom: "1px solid #f1f5f9" }}>
                <td style={{ padding: "14px 16px", fontWeight: "700", color: "#0f172a" }}>Universal Products</td>
                <td style={{ padding: "14px 16px", textAlign: "center", color: "#cbd5e1" }}>✕</td>
                <td style={{ padding: "14px 16px", textAlign: "center", background: "#f8fafc", fontWeight: "700", color: "#047857" }}>✓ Unlimited</td>
                <td style={{ padding: "14px 16px", textAlign: "center", fontWeight: "700" }}>✓ Unlimited</td>
              </tr>
              <tr style={{ borderBottom: "1px solid #f1f5f9" }}>
                <td style={{ padding: "14px 16px", fontWeight: "700", color: "#0f172a" }}>Product Page Fitment Checker</td>
                <td style={{ padding: "14px 16px", textAlign: "center", color: "#cbd5e1" }}>✕</td>
                <td style={{ padding: "14px 16px", textAlign: "center", background: "#f8fafc", fontWeight: "700", color: "#047857" }}>✓ Included</td>
                <td style={{ padding: "14px 16px", textAlign: "center", fontWeight: "700" }}>✓ Included</td>
              </tr>
              <tr style={{ borderBottom: "1px solid #f1f5f9" }}>
                <td style={{ padding: "14px 16px", fontWeight: "700", color: "#0f172a" }}>My Garage Saved Vehicles</td>
                <td style={{ padding: "14px 16px", textAlign: "center" }}>Local Storage</td>
                <td style={{ padding: "14px 16px", textAlign: "center", background: "#f8fafc", fontWeight: "700" }}>Local + Persistence</td>
                <td style={{ padding: "14px 16px", textAlign: "center", fontWeight: "700" }}>Cross-Device Sync</td>
              </tr>
              <tr style={{ borderBottom: "1px solid #f1f5f9" }}>
                <td style={{ padding: "14px 16px", fontWeight: "700", color: "#0f172a" }}>CSV Bulk Import / Export</td>
                <td style={{ padding: "14px 16px", textAlign: "center", color: "#cbd5e1" }}>✕</td>
                <td style={{ padding: "14px 16px", textAlign: "center", background: "#f8fafc", fontWeight: "700", color: "#047857" }}>✓ Unlimited</td>
                <td style={{ padding: "14px 16px", textAlign: "center", fontWeight: "700" }}>✓ Automated Sync</td>
              </tr>
              <tr style={{ borderBottom: "1px solid #f1f5f9" }}>
                <td style={{ padding: "14px 16px", fontWeight: "700", color: "#0f172a" }}>Search Analytics & Logs</td>
                <td style={{ padding: "14px 16px", textAlign: "center" }}>Basic Summary</td>
                <td style={{ padding: "14px 16px", textAlign: "center", background: "#f8fafc", fontWeight: "700", color: "#047857" }}>Detailed + Gap Logs</td>
                <td style={{ padding: "14px 16px", textAlign: "center", fontWeight: "700" }}>Realtime Export</td>
              </tr>
              <tr style={{ borderBottom: "1px solid #f1f5f9" }}>
                <td style={{ padding: "14px 16px", fontWeight: "700", color: "#0f172a" }}>Results Display Options</td>
                <td style={{ padding: "14px 16px", textAlign: "center" }}>Inline Only</td>
                <td style={{ padding: "14px 16px", textAlign: "center", background: "#f8fafc", fontWeight: "700", color: "#047857" }}>✓ /collections/all, Dedicated Page & Inline</td>
                <td style={{ padding: "14px 16px", textAlign: "center", fontWeight: "700" }}>✓ Multi-Layout & Custom Theme Integration</td>
              </tr>
              <tr style={{ borderBottom: "1px solid #f1f5f9" }}>
                <td style={{ padding: "14px 16px", fontWeight: "700", color: "#0f172a" }}>AI Fitment Matcher (Beta)</td>
                <td style={{ padding: "14px 16px", textAlign: "center", color: "#cbd5e1" }}>✕</td>
                <td style={{ padding: "14px 16px", textAlign: "center", background: "#f8fafc", color: "#cbd5e1" }}>✕</td>
                <td style={{ padding: "14px 16px", textAlign: "center", fontWeight: "800", color: "#047857" }}>✓ Included (AI Suggestions)</td>
              </tr>
              <tr style={{ borderBottom: "1px solid #f1f5f9" }}>
                <td style={{ padding: "14px 16px", fontWeight: "700", color: "#0f172a" }}>Storefront Proxy SLA & Performance</td>
                <td style={{ padding: "14px 16px", textAlign: "center" }}>Standard App Proxy</td>
                <td style={{ padding: "14px 16px", textAlign: "center", background: "#f8fafc", fontWeight: "700", color: "#047857" }}>✓ High-Speed CDN Proxy</td>
                <td style={{ padding: "14px 16px", textAlign: "center", fontWeight: "700" }}>✓ VIP Dedicated Proxy & Edge Caching</td>
              </tr>
              <tr style={{ borderBottom: "1px solid #f1f5f9" }}>
                <td style={{ padding: "14px 16px", fontWeight: "700", color: "#0f172a" }}>Database Backups & Safety</td>
                <td style={{ padding: "14px 16px", textAlign: "center" }}>Weekly Auto-Backup</td>
                <td style={{ padding: "14px 16px", textAlign: "center", background: "#f8fafc", fontWeight: "700" }}>Daily Automated Backups</td>
                <td style={{ padding: "14px 16px", textAlign: "center", fontWeight: "700" }}>Hourly Realtime Backups</td>
              </tr>
              <tr style={{ borderBottom: "1px solid #f1f5f9" }}>
                <td style={{ padding: "14px 16px", fontWeight: "700", color: "#0f172a" }}>Support SLA</td>
                <td style={{ padding: "14px 16px", textAlign: "center" }}>Standard Email</td>
                <td style={{ padding: "14px 16px", textAlign: "center", background: "#f8fafc", fontWeight: "700" }}>Priority Support</td>
                <td style={{ padding: "14px 16px", textAlign: "center", fontWeight: "700" }}>VIP 1-on-1 Manager</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
