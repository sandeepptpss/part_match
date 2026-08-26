const json = (data, init) => Response.json(data, init);
import { useState } from "react";
import { useLoaderData, useActionData, useNavigation, Form } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { BILLING_PLAN_KEYS, isTestCharge, planLimits, syncShopPlanFromBilling } from "../plans.server";

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
    userEmail === "sandeepptpss@gmail.com" ||
    true;

  let fitmentCount = 0;
  let productMappingCount = 0;
  let universalCount = 0;
  let searchLogCount = 0;
  let appSettings = null;

  try {
    const res = await Promise.all([
      prisma.fitmentRecord?.count({ where: { shop } }) ?? 0,
      prisma.fitmentProduct?.count({ where: { fitment: { shop } } }) ?? 0,
      prisma.universalProduct?.count({ where: { shop } }) ?? 0,
      prisma.searchLog?.count({ where: { shop } }) ?? 0,
      prisma.appSettings?.findFirst({ where: { shop } }),
    ]);
    fitmentCount = res[0];
    productMappingCount = res[1];
    universalCount = res[2];
    searchLogCount = res[3];
    appSettings = res[4];
  } catch (err) {
    console.error("[plans loader] Error fetching stats:", err);
  }

  const discountPercent = appSettings?.annualDiscountPercent ?? 20;

  const shopPlan = await syncShopPlanFromBilling(billing, shop);
  const limits = planLimits(shopPlan.plan);

  return {
    shop,
    fitmentCount,
    productMappingCount,
    universalCount,
    searchLogCount,
    sessionEmail,
    isAdmin,
    discountPercent,
    activePlan: shopPlan.plan,
    billingCycle: shopPlan.billingCycle,
    recordsLimit: Number.isFinite(limits.fitmentLimit) ? limits.fitmentLimit : null,
  };
};

export const action = async ({ request }) => {
  const { session, billing } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "updateDiscount") {
    const discount = parseInt(formData.get("annualDiscountPercent"), 10) || 20;

    // Update discount in DB for shop
    await prisma.appSettings.upsert({
      where: { shop },
      update: { annualDiscountPercent: discount },
      create: { shop, annualDiscountPercent: discount },
    });

    return json({
      success: true,
      message: `Annual Discount updated to ${discount}% by Admin!`,
    });
  }

  if (intent === "selectPlan") {
    const selectedPlan = formData.get("plan");
    const billingCycle = formData.get("billingCycle") === "annual" ? "annual" : "monthly";

    if (selectedPlan === "free") {
      const { appSubscriptions } = await billing.check();
      const active = appSubscriptions?.[0];
      if (active) {
        await billing.cancel({ subscriptionId: active.id, isTest: isTestCharge });
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
    const returnUrl = `${url.origin}/app/plans${url.search}`;

    // Throws a redirect to Shopify's real charge-confirmation screen. Once the
    // merchant approves, Shopify redirects back to returnUrl and the loader's
    // syncShopPlanFromBilling call re-reads the real subscription state.
    await billing.request({ plan: billingPlanKey, isTest: isTestCharge, returnUrl });
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
    sessionEmail,
    isAdmin,
    discountPercent: initialDiscount,
    activePlan,
    recordsLimit,
  } = useLoaderData();

  const actionData = useActionData();
  const navigation = useNavigation();
  const [billingCycle, setBillingCycle] = useState("monthly"); // "monthly" | "annual"
  const [adminDiscountInput, setAdminDiscountInput] = useState(initialDiscount);
  const [openFaq, setOpenFaq] = useState({});

  const toggleFaq = (id) => {
    setOpenFaq((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const isSubmitting = navigation.state !== "idle";
  const currentDiscount = navigation.formData?.get("intent") === "updateDiscount"
    ? parseInt(navigation.formData.get("annualDiscountPercent"), 10) || initialDiscount
    : initialDiscount;

  // Calculate annual prices based on dynamic admin discount percentage
  const calcAnnual = (monthlyPrice) => {
    if (monthlyPrice === 0) return "$0";
    const discounted = monthlyPrice * (1 - currentDiscount / 100);
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
        "Single Page Inline Results",
        "Local Storage Vehicle Garage",
        "Standard Email Support",
      ],
      disabledFeatures: [
        "Universal Products Support",
        "Product Compatibility Checker",
        "CSV Bulk Import & Export",
        "Search Analytics & Logs",
      ],
    },
    {
      id: "growth",
      name: "Growth Professional",
      priceMonthly: "$19.99",
      priceAnnual: calcAnnual(19.99),
      period: "per month",
      description: "Complete fitment solution for growing auto parts retailers.",
      recordsLimit: "5,000 Fitment Records",
      badge: "MOST POPULAR",
      highlight: true,
      features: [
        "Up to 5,000 Fitment Records",
        "Unlimited Universal Products",
        "Native Collection & Custom Results Grid",
        "Product Page Fitment Checker Badge",
        "My Garage Vehicle Persistence",
        "CSV Bulk Import & Export",
        "Search Analytics & Failed Query Logging",
        "Priority Email & Chat Support",
      ],
      disabledFeatures: [],
    },
    {
      id: "enterprise",
      name: "Enterprise Unlimited",
      priceMonthly: "$49.99",
      priceAnnual: calcAnnual(49.99),
      period: "per month",
      description: "Maximum scale & dedicated performance for large automotive catalogs.",
      recordsLimit: "Unlimited Fitment Records",
      badge: "UNLIMITED",
      highlight: false,
      features: [
        "Unlimited Fitment Records",
        "Unlimited Universal Products",
        "All Growth Professional Features",
        "Server-Side Cross-Device Garage Sync",
        "High-Speed Proxy SLA & CDN Caching",
        "Daily Automated Database Backups",
        "VIP Dedicated Account Manager",
        "Custom Storefront Integration Help",
      ],
      disabledFeatures: [],
    },
  ];

  const faqs = [
    {
      id: "faq-1",
      question: "Can I upgrade or downgrade my plan at any time?",
      answer:
        "Yes! You can switch plans whenever your business needs change. Upgrade immediately to unlock higher record limits and features, or downgrade with zero data loss.",
    },
    {
      id: "faq-2",
      question: "What happens if I reach my fitment record limit?",
      answer:
        "Your existing vehicle search widgets and storefront fitment lookup will continue working seamlessly. You will simply be prompted to upgrade to add new vehicle records.",
    },
    {
      id: "faq-3",
      question: "Does PartMatch affect my storefront load speed?",
      answer:
        "Not at all. PartMatch storefront scripts are lightweight (under 12KB) and load asynchronously via CDN, ensuring zero delay to your theme rendering.",
    },
    {
      id: "faq-4",
      question: "How does the annual billing discount work?",
      answer: `Choosing annual billing saves you ${currentDiscount}% compared to monthly billing, giving you discounted rate every year.`,
    },
  ];

  return (
    <div style={{ maxWidth: "1100px", margin: "0 auto", padding: "24px", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" }}>
      {/* Toast Notification */}
      {actionData?.message && (
        <div style={{ background: "#e6f4ea", border: "1px solid #b7e1cd", color: "#137333", padding: "14px 20px", borderRadius: "8px", marginBottom: "24px", fontWeight: "600" }}>
          ✓ {actionData.message}
        </div>
      )}



      {/* Header Banner Card */}
      <div style={{ background: "#ffffff", border: "1px solid #e1e3e5", borderRadius: "12px", padding: "28px", marginBottom: "28px", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px", marginBottom: "20px" }}>
          <div>
            <h1 style={{ margin: "0 0 6px", fontSize: "26px", fontWeight: "700", color: "#1a1a1a" }}>
              PartMatch Billing & Pricing Plans
            </h1>
            <p style={{ margin: 0, color: "#6d7175", fontSize: "15px" }}>
              Scale your automotive fitment search seamlessly with flexible plans.
            </p>
          </div>
          <div style={{ background: "#f0f7ff", border: "1px solid #b3d4f5", color: "#005bd3", padding: "8px 16px", borderRadius: "20px", fontSize: "14px", fontWeight: "600" }}>
            Current Usage: {fitmentCount} / {recordsLimit === null ? "Unlimited" : recordsLimit.toLocaleString()} Records
          </div>
        </div>

        <hr style={{ border: 0, borderTop: "1px solid #e1e3e5", margin: "20px 0" }} />

        {/* Monthly vs Annual Billing Toggle */}
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "14px" }}>
          <span style={{ fontSize: "14px", fontWeight: billingCycle === "monthly" ? "700" : "400", color: "#1a1a1a" }}>
            Monthly Billing
          </span>

          <button
            type="button"
            onClick={() => setBillingCycle(billingCycle === "monthly" ? "annual" : "monthly")}
            style={{
              background: billingCycle === "annual" ? "#008060" : "#dfe3e8",
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

          <span style={{ fontSize: "14px", fontWeight: billingCycle === "annual" ? "700" : "400", color: "#1a1a1a" }}>
            Annual Billing <span style={{ background: "#e6f4ea", color: "#137333", padding: "3px 8px", borderRadius: "10px", fontSize: "12px", fontWeight: "700", marginLeft: "4px" }}>Save {currentDiscount}%</span>
          </span>
        </div>
      </div>

      {/* Pricing Cards Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "24px", marginBottom: "36px" }}>
        {plans.map((plan) => {
          const isCurrent = activePlan === plan.id;
          const displayPrice = billingCycle === "annual" ? plan.priceAnnual : plan.priceMonthly;

          return (
            <div
              key={plan.id}
              style={{
                background: plan.highlight ? "#f9fafb" : "#ffffff",
                border: plan.highlight ? "2px solid #008060" : "1px solid #e1e3e5",
                borderRadius: "14px",
                padding: "28px",
                boxShadow: plan.highlight ? "0 4px 20px rgba(0,128,96,0.15)" : "0 2px 8px rgba(0,0,0,0.04)",
                position: "relative",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
              }}
            >
              {plan.badge && (
                <div style={{ position: "absolute", top: "-12px", right: "20px", background: "#008060", color: "#ffffff", padding: "4px 12px", borderRadius: "12px", fontSize: "11px", fontWeight: "700", letterSpacing: "0.5px" }}>
                  {plan.badge}
                </div>
              )}
              {isCurrent && !plan.badge && (
                <div style={{ position: "absolute", top: "-12px", right: "20px", background: "#6d7175", color: "#ffffff", padding: "4px 12px", borderRadius: "12px", fontSize: "11px", fontWeight: "700" }}>
                  ACTIVE PLAN
                </div>
              )}

              <div>
                <h3 style={{ margin: "0 0 8px", fontSize: "20px", fontWeight: "700", color: "#1a1a1a" }}>
                  {plan.name}
                </h3>
                <p style={{ margin: "0 0 20px", color: "#6d7175", fontSize: "13px", lineHeight: "1.4" }}>
                  {plan.description}
                </p>

                {/* Price Display */}
                <div style={{ display: "flex", alignItems: "baseline", gap: "6px", marginBottom: "16px" }}>
                  <span style={{ fontSize: "36px", fontWeight: "800", color: "#1a1a1a" }}>{displayPrice}</span>
                  <span style={{ fontSize: "14px", color: "#6d7175" }}>{plan.period}</span>
                </div>

                <div style={{ display: "inline-block", background: "#f4f6f8", color: "#454f5b", padding: "4px 10px", borderRadius: "6px", fontSize: "12px", fontWeight: "600", marginBottom: "20px" }}>
                  {plan.recordsLimit}
                </div>

                {/* Submit Action Form — a real Form (not a fetcher) so Shopify's
                    billing-confirmation redirect performs a full navigation */}
                <Form method="post" style={{ marginBottom: "24px" }}>
                  <input type="hidden" name="intent" value="selectPlan" />
                  <input type="hidden" name="plan" value={plan.id} />
                  <input type="hidden" name="billingCycle" value={billingCycle} />
                  <button
                    type="submit"
                    disabled={isCurrent || isSubmitting}
                    style={{
                      width: "100%",
                      padding: "12px 16px",
                      borderRadius: "8px",
                      border: plan.highlight ? "none" : "1px solid #babfc3",
                      background: isCurrent ? "#e4e5e7" : plan.highlight ? "#008060" : "#ffffff",
                      color: isCurrent ? "#8c9196" : plan.highlight ? "#ffffff" : "#202223",
                      fontSize: "14px",
                      fontWeight: "700",
                      cursor: isCurrent ? "default" : "pointer",
                      transition: "all 0.2s",
                    }}
                  >
                    {isCurrent ? "Current Active Plan" : `Upgrade to ${plan.name}`}
                  </button>
                </Form>

                <hr style={{ border: 0, borderTop: "1px solid #e1e3e5", margin: "20px 0" }} />

                {/* Features list */}
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <span style={{ fontSize: "12px", fontWeight: "700", color: "#6d7175", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                    Included Features:
                  </span>
                  {plan.features.map((feat, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "#202223" }}>
                      <span style={{ color: "#008060", fontWeight: "800" }}>✓</span>
                      <span>{feat}</span>
                    </div>
                  ))}
                  {plan.disabledFeatures.map((feat, i) => (
                    <div key={`d-${i}`} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "#8c9196" }}>
                      <span style={{ color: "#8c9196" }}>✕</span>
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
      <div style={{ background: "#ffffff", border: "1px solid #e1e3e5", borderRadius: "12px", padding: "28px", marginBottom: "36px", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
        <h2 style={{ margin: "0 0 16px", fontSize: "20px", fontWeight: "700", color: "#1a1a1a" }}>
          Feature Comparison Matrix
        </h2>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "14px" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #e1e3e5" }}>
                <th style={{ padding: "12px", width: "40%", color: "#6d7175" }}>Feature</th>
                <th style={{ padding: "12px", textAlign: "center", color: "#6d7175" }}>Starter Free</th>
                <th style={{ padding: "12px", textAlign: "center", background: "#f4f6f8", color: "#008060", fontWeight: "700" }}>Growth Pro</th>
                <th style={{ padding: "12px", textAlign: "center", color: "#6d7175" }}>Enterprise</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ borderBottom: "1px solid #eeeeee" }}>
                <td style={{ padding: "12px", fontWeight: "600" }}>Fitment Records Capacity</td>
                <td style={{ padding: "12px", textAlign: "center" }}>100</td>
                <td style={{ padding: "12px", textAlign: "center", background: "#f9fafb", fontWeight: "700" }}>5,000</td>
                <td style={{ padding: "12px", textAlign: "center" }}>Unlimited</td>
              </tr>
              <tr style={{ borderBottom: "1px solid #eeeeee" }}>
                <td style={{ padding: "12px", fontWeight: "600" }}>Universal Products</td>
                <td style={{ padding: "12px", textAlign: "center", color: "#8c9196" }}>✕</td>
                <td style={{ padding: "12px", textAlign: "center", background: "#f9fafb" }}>✓ Unlimited</td>
                <td style={{ padding: "12px", textAlign: "center" }}>✓ Unlimited</td>
              </tr>
              <tr style={{ borderBottom: "1px solid #eeeeee" }}>
                <td style={{ padding: "12px", fontWeight: "600" }}>Product Page Fitment Checker</td>
                <td style={{ padding: "12px", textAlign: "center", color: "#8c9196" }}>✕</td>
                <td style={{ padding: "12px", textAlign: "center", background: "#f9fafb" }}>✓ Included</td>
                <td style={{ padding: "12px", textAlign: "center" }}>✓ Included</td>
              </tr>
              <tr style={{ borderBottom: "1px solid #eeeeee" }}>
                <td style={{ padding: "12px", fontWeight: "600" }}>My Garage Saved Vehicles</td>
                <td style={{ padding: "12px", textAlign: "center" }}>Local Storage</td>
                <td style={{ padding: "12px", textAlign: "center", background: "#f9fafb" }}>Local + Persistence</td>
                <td style={{ padding: "12px", textAlign: "center" }}>Cross-Device Sync</td>
              </tr>
              <tr style={{ borderBottom: "1px solid #eeeeee" }}>
                <td style={{ padding: "12px", fontWeight: "600" }}>CSV Bulk Import / Export</td>
                <td style={{ padding: "12px", textAlign: "center", color: "#8c9196" }}>✕</td>
                <td style={{ padding: "12px", textAlign: "center", background: "#f9fafb" }}>✓ Unlimited</td>
                <td style={{ padding: "12px", textAlign: "center" }}>✓ Automated Sync</td>
              </tr>
              <tr style={{ borderBottom: "1px solid #eeeeee" }}>
                <td style={{ padding: "12px", fontWeight: "600" }}>Search Analytics & Logs</td>
                <td style={{ padding: "12px", textAlign: "center" }}>Basic</td>
                <td style={{ padding: "12px", textAlign: "center", background: "#f9fafb" }}>Detailed + No-Result Logs</td>
                <td style={{ padding: "12px", textAlign: "center" }}>Realtime Export</td>
              </tr>
              <tr style={{ borderBottom: "1px solid #eeeeee" }}>
                <td style={{ padding: "12px", fontWeight: "600" }}>Support SLA</td>
                <td style={{ padding: "12px", textAlign: "center" }}>Standard Email</td>
                <td style={{ padding: "12px", textAlign: "center", background: "#f9fafb" }}>Priority Support</td>
                <td style={{ padding: "12px", textAlign: "center" }}>VIP 1-on-1 Manager</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* FAQ Section */}
      <div style={{ background: "#ffffff", border: "1px solid #e1e3e5", borderRadius: "12px", padding: "28px", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
        <h2 style={{ margin: "0 0 16px", fontSize: "20px", fontWeight: "700", color: "#1a1a1a" }}>
          Frequently Asked Questions
        </h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {faqs.map((faq) => {
            const isOpen = openFaq[faq.id];
            return (
              <div key={faq.id} style={{ border: "1px solid #e1e3e5", borderRadius: "8px", overflow: "hidden" }}>
                <button
                  type="button"
                  onClick={() => toggleFaq(faq.id)}
                  style={{
                    width: "100%",
                    padding: "16px 20px",
                    background: "#ffffff",
                    border: "none",
                    textAlign: "left",
                    fontSize: "15px",
                    fontWeight: "600",
                    color: "#1a1a1a",
                    cursor: "pointer",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <span>{faq.question}</span>
                  <span style={{ color: "#6d7175", fontSize: "12px" }}>{isOpen ? "▲" : "▼"}</span>
                </button>
                {isOpen && (
                  <div style={{ padding: "0 20px 16px", color: "#6d7175", fontSize: "14px", lineHeight: "1.5", borderTop: "1px solid #f4f6f8" }}>
                    {faq.answer}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
