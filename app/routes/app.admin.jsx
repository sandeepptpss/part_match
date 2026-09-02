const json = (data, init) => Response.json(data, init);
import { useState, useMemo, useEffect } from "react";
import { useLoaderData, useFetcher, redirect } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const currentShop = session.shop;

  // eslint-disable-next-line no-undef
  const adminEmail = process.env.ADMIN_EMAIL || "sandeepptpss@gmail.com";
  // eslint-disable-next-line no-undef
  const adminStore = process.env.ADMIN_STORE_NAME || "quickstart-749ac396";

  const sessionEmail = session.email || adminEmail;

  // Admin access check
  const isAdmin =
    currentShop.includes(adminStore) ||
    currentShop.includes("quickstart-749ac396") ||
    sessionEmail.includes("sandeepptpss") ||
    sessionEmail === adminEmail;

  if (!isAdmin) {
    return redirect("/app");
  }

  let shopsList = [];
  let totalRecords = 0;
  let totalProducts = 0;
  let totalSearches = 0;
  let globalDiscount = 20;

  let isSupportOnline = true;
  try {
    // Fetch Global Settings
    const globalSettings = await prisma.appSettings.findFirst({
      where: { shop: "__GLOBAL__" },
    });
    if (globalSettings?.annualDiscountPercent != null) {
      globalDiscount = globalSettings.annualDiscountPercent;
    }
    if (globalSettings?.isSupportOnline != null) {
      isSupportOnline = globalSettings.isSupportOnline;
    }

    // Get unique shops
    const settingsList = (await prisma.appSettings.findMany()) ?? [];
    const sessions = (await prisma.session.findMany({ select: { shop: true, email: true } })) ?? [];
    const shopPlansList = (await prisma.shopPlan.findMany()) ?? [];

    const shopSet = new Set([
      currentShop,
      ...settingsList.map((s) => s.shop).filter((s) => s !== "__GLOBAL__"),
      ...sessions.map((s) => s.shop).filter((s) => s !== "__GLOBAL__"),
    ]);

    const shopDomains = Array.from(shopSet);

    // Detailed per-shop stats
    shopsList = await Promise.all(
      shopDomains.map(async (domain) => {
        const [fitments, mappings, universals, searches, settings] = await Promise.all([
          prisma.fitmentRecord.count({ where: { shop: domain } }) ?? 0,
          prisma.fitmentProduct.count({ where: { fitment: { shop: domain } } }) ?? 0,
          prisma.universalProduct.count({ where: { shop: domain } }) ?? 0,
          prisma.searchLog.count({ where: { shop: domain } }) ?? 0,
          prisma.appSettings.findFirst({ where: { shop: domain } }),
        ]);

        const sessionMatch = sessions.find((s) => s.shop === domain);
        const contactEmail = sessionMatch?.email || adminEmail;
        const planObj = shopPlansList.find((p) => p.shop === domain);
        const activePlanLabel = planObj?.plan
          ? planObj.plan === "enterprise"
            ? "Enterprise Unlimited ($49.99/mo)"
            : planObj.plan === "growth"
            ? "Growth Professional ($19.99/mo)"
            : "Starter Free ($0/mo)"
          : "Growth Professional ($19.99/mo)";

        const merchantDiscount =
          settings?.merchantDiscountPercent != null
            ? settings.merchantDiscountPercent
            : settings?.annualDiscountPercent != null && settings.annualDiscountPercent !== globalDiscount
            ? settings.annualDiscountPercent
            : 0;
        const isCustomDiscount = merchantDiscount > 0;

        return {
          shop: domain,
          email: contactEmail,
          fitments,
          mappings,
          universals,
          searches,
          merchantDiscountPercent: merchantDiscount,
          isCustomDiscount,
          activePlan: activePlanLabel,
          status: "Active",
        };
      })
    );

    // Global aggregations
    totalRecords = (await prisma.fitmentRecord.count()) ?? 0;
    totalProducts = (await prisma.fitmentProduct.count()) ?? 0;
    totalSearches = (await prisma.searchLog.count()) ?? 0;
  } catch (err) {
    console.error("[admin loader error]", err);
  }

  return json({
    currentShop,
    sessionEmail,
    isAdmin,
    shopsList,
    totalRecords,
    totalProducts,
    totalSearches,
    globalDiscount,
    isSupportOnline,
  });
};

export const action = async ({ request }) => {
  await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "toggleSupportStatus") {
    const currentStatus = formData.get("currentSupportStatus") === "true";
    const nextStatus = !currentStatus;

    await prisma.appSettings.upsert({
      where: { shop: "__GLOBAL__" },
      update: { isSupportOnline: nextStatus },
      create: { shop: "__GLOBAL__", isSupportOnline: nextStatus },
    });

    return json({
      success: true,
      intent: "toggleSupportStatus",
      isSupportOnline: nextStatus,
      message: `Global Merchant Support Desk status set to: ${nextStatus ? "ONLINE" : "OFFLINE"}!`,
    });
  }

  if (intent === "saveGlobalDiscount") {
    const discount = parseInt(formData.get("globalDiscountPercent"), 10) || 20;

    await prisma.appSettings.upsert({
      where: { shop: "__GLOBAL__" },
      update: { annualDiscountPercent: discount },
      create: {
        shop: "__GLOBAL__",
        annualDiscountPercent: discount,
      },
    });

    return json({
      success: true,
      intent: "saveGlobalDiscount",
      message: `Global Default Annual Discount updated to ${discount}% successfully!`,
    });
  }

  if (intent === "saveUserDiscount") {
    const targetShop = formData.get("targetShop");
    const userDiscount = parseInt(formData.get("userDiscountPercent"), 10);

    if (!targetShop || isNaN(userDiscount)) {
      return json({ success: false, message: "Invalid shop domain or discount rate." }, { status: 400 });
    }

    const globalSettings = await prisma.appSettings.findFirst({ where: { shop: "__GLOBAL__" } });
    const globalDiscount = globalSettings?.annualDiscountPercent ?? 20;
    const annualDiscountToSave = userDiscount > 0 ? userDiscount : globalDiscount;

    try {
      await prisma.appSettings.upsert({
        where: { shop: targetShop },
        update: {
          merchantDiscountPercent: userDiscount,
          annualDiscountPercent: annualDiscountToSave,
        },
        create: {
          shop: targetShop,
          merchantDiscountPercent: userDiscount,
          annualDiscountPercent: annualDiscountToSave,
        },
      });
    } catch (err) {
      console.warn("[saveUserDiscount] Falling back to annualDiscountPercent field:", err?.message);
      await prisma.appSettings.upsert({
        where: { shop: targetShop },
        update: { annualDiscountPercent: annualDiscountToSave },
        create: {
          shop: targetShop,
          annualDiscountPercent: annualDiscountToSave,
        },
      });
    }

    return json({
      success: true,
      intent: "saveUserDiscount",
      targetShop,
      message:
        userDiscount > 0
          ? `Merchant VIP discount of ${userDiscount}% applied successfully for: ${targetShop}!`
          : `Merchant discount for ${targetShop} set to 0% (Standard)!`,
    });
  }

  if (intent === "resetUserDiscount") {
    const targetShop = formData.get("targetShop");
    if (targetShop) {
      const globalSettings = await prisma.appSettings.findFirst({ where: { shop: "__GLOBAL__" } });
      const globalDiscount = globalSettings?.annualDiscountPercent ?? 20;

      try {
        await prisma.appSettings.upsert({
          where: { shop: targetShop },
          update: {
            merchantDiscountPercent: 0,
            annualDiscountPercent: globalDiscount,
          },
          create: { shop: targetShop, merchantDiscountPercent: 0, annualDiscountPercent: globalDiscount },
        });
      } catch (err) {
        console.warn("[resetUserDiscount] Falling back to annualDiscountPercent reset:", err?.message);
        await prisma.appSettings.upsert({
          where: { shop: targetShop },
          update: { annualDiscountPercent: globalDiscount },
          create: { shop: targetShop, annualDiscountPercent: globalDiscount },
        });
      }

      return json({
        success: true,
        intent: "resetUserDiscount",
        targetShop,
        message: `Merchant VIP discount for ${targetShop} reset to 0%!`,
      });
    }
  }

  if (intent === "clearLogs") {
    await prisma.searchLog.deleteMany({});
    return json({
      success: true,
      intent: "clearLogs",
      message: "Search logs cleared successfully across all merchant accounts!",
    });
  }

  return json({ success: false });
};

export default function AdminPage() {
  const {
    currentShop,
    sessionEmail,
    shopsList,
    totalRecords,
    totalProducts,
    totalSearches,
    globalDiscount,
    isSupportOnline: initialIsSupportOnline,
  } = useLoaderData();

  const supportFetcher = useFetcher();
  const discountFetcher = useFetcher();
  const logsFetcher = useFetcher();
  const userDiscountFetcher = useFetcher();

  const isSupportOnline = supportFetcher.data?.isSupportOnline ?? initialIsSupportOnline;
  const isSupportSubmitting = supportFetcher.state !== "idle";
  const isDiscountSubmitting = discountFetcher.state !== "idle";
  const isLogsSubmitting = logsFetcher.state !== "idle";
  const isUserDiscountSubmitting = userDiscountFetcher.state !== "idle";

  const activeNotification =
    supportFetcher.data?.message
      ? supportFetcher.data
      : discountFetcher.data?.message
      ? discountFetcher.data
      : logsFetcher.data?.message
      ? logsFetcher.data
      : userDiscountFetcher.data?.message
      ? userDiscountFetcher.data
      : null;

  const [globalDiscountInput, setGlobalDiscountInput] = useState(globalDiscount);
  const [searchQuery, setSearchQuery] = useState("");
  const [userDiscountInputs, setUserDiscountInputs] = useState(() => {
    const initial = {};
    shopsList.forEach((s) => {
      initial[s.shop] = s.merchantDiscountPercent;
    });
    return initial;
  });

  useEffect(() => {
    const updatedInputs = {};
    shopsList.forEach((s) => {
      updatedInputs[s.shop] = s.merchantDiscountPercent;
    });
    setUserDiscountInputs(updatedInputs);
  }, [shopsList]);

  const handleUserDiscountChange = (shop, value) => {
    setUserDiscountInputs((prev) => ({
      ...prev,
      [shop]: value,
    }));
  };

  const filteredShops = useMemo(() => {
    if (!searchQuery.trim()) return shopsList;
    const query = searchQuery.toLowerCase();
    return shopsList.filter(
      (s) =>
        s.shop.toLowerCase().includes(query) ||
        (s.email && s.email.toLowerCase().includes(query))
    );
  }, [shopsList, searchQuery]);

  return (
    <div
      style={{
        maxWidth: "1200px",
        margin: "0 auto",
        padding: "20px 16px",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'San Francisco', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        color: "#0f172a",
        boxSizing: "border-box",
      }}
    >
      {/* Toast Notification Alert */}
      {activeNotification?.message && (
        <div
          style={{
            background: activeNotification?.success !== false ? "#f0fdf4" : "#fef2f2",
            border: `1px solid ${
              activeNotification?.success !== false ? "#bbf7d0" : "#fecaca"
            }`,
            color: activeNotification?.success !== false ? "#166534" : "#991b1b",
            padding: "12px 16px",
            borderRadius: "10px",
            marginBottom: "20px",
            fontWeight: "600",
            fontSize: "13px",
            display: "flex",
            alignItems: "center",
            gap: "10px",
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center" }}>
            {activeNotification?.success !== false ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
              </svg>
            )}
          </span>
          <div>{activeNotification.message}</div>
        </div>
      )}

      {/* Top Banner */}
      <div
        style={{
          background: "linear-gradient(135deg, #064e3b 0%, #047857 60%, #0f766e 100%)",
          color: "#ffffff",
          borderRadius: "14px",
          padding: "24px 28px",
          marginBottom: "24px",
          boxShadow: "0 4px 20px -2px rgba(6, 78, 59, 0.2)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "16px",
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
              <span
                style={{
                  background: "rgba(255, 255, 255, 0.18)",
                  color: "#ffffff",
                  padding: "3px 9px",
                  borderRadius: "20px",
                  fontSize: "10px",
                  fontWeight: "700",
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                  border: "1px solid rgba(255, 255, 255, 0.25)",
                }}
              >
                Super Admin Console
              </span>
              <span
                style={{
                  background: "#34d399",
                  color: "#064e3b",
                  padding: "2px 8px",
                  borderRadius: "10px",
                  fontSize: "10px",
                  fontWeight: "800",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: "#064e3b" }}></span>
                System Live
              </span>
            </div>
            <h1
              style={{
                margin: "0 0 4px",
                fontSize: "24px",
                fontWeight: "800",
                letterSpacing: "-0.02em",
                color: "#ffffff",
              }}
            >
              PartMatch Control Center
            </h1>
            <p style={{ margin: 0, color: "#a7f3d0", fontSize: "13px", fontWeight: "500" }}>
              Logged in as <strong>{sessionEmail}</strong> &bull; Active Domain: <strong>{currentShop}</strong>
            </p>
          </div>

          <div
            style={{
              background: "rgba(255, 255, 255, 0.12)",
              padding: "12px 20px",
              borderRadius: "12px",
              border: "1px solid rgba(255, 255, 255, 0.2)",
              backdropFilter: "blur(8px)",
              textAlign: "right",
            }}
          >
            <div style={{ fontSize: "10px", color: "#a7f3d0", fontWeight: "700", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: "2px" }}>
              Global Default Discount
            </div>
            <div style={{ fontSize: "22px", fontWeight: "800", color: "#ffffff", letterSpacing: "-0.02em" }}>
              {globalDiscount}% <span style={{ fontSize: "12px", fontWeight: "700", color: "#6ee7b7" }}>OFF</span>
            </div>
          </div>
        </div>
      </div>

      {/* System Metrics Grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "16px",
          marginBottom: "24px",
        }}
      >
        {/* Installed Stores Card */}
        <div
          style={{
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderTop: "3px solid #059669",
            borderRadius: "12px",
            padding: "18px 20px",
            boxShadow: "0 1px 3px rgba(0, 0, 0, 0.04)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
            <span style={{ fontSize: "11px", color: "#64748b", fontWeight: "700", letterSpacing: "0.05em", textTransform: "uppercase" }}>
              Installed Stores
            </span>
            <div style={{ width: "34px", height: "34px", background: "#ecfdf5", color: "#059669", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                <polyline points="9 22 9 12 15 12 15 22"></polyline>
              </svg>
            </div>
          </div>
          <div style={{ fontSize: "28px", fontWeight: "800", color: "#0f172a", lineHeight: "1.2" }}>
            {shopsList.length}
          </div>
          <div style={{ fontSize: "12px", color: "#059669", fontWeight: "600", marginTop: "4px" }}>
            Active Merchant Accounts
          </div>
        </div>

        {/* Fitment Records Card */}
        <div
          style={{
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderTop: "3px solid #2563eb",
            borderRadius: "12px",
            padding: "18px 20px",
            boxShadow: "0 1px 3px rgba(0, 0, 0, 0.04)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
            <span style={{ fontSize: "11px", color: "#64748b", fontWeight: "700", letterSpacing: "0.05em", textTransform: "uppercase" }}>
              Fitment Records
            </span>
            <div style={{ width: "34px", height: "34px", background: "#eff6ff", color: "#2563eb", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
                <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path>
                <path d="M21 19c0 1.66-4 3-9 3s-9-1.34-9-3"></path>
              </svg>
            </div>
          </div>
          <div style={{ fontSize: "28px", fontWeight: "800", color: "#0f172a", lineHeight: "1.2" }}>
            {totalRecords.toLocaleString()}
          </div>
          <div style={{ fontSize: "12px", color: "#2563eb", fontWeight: "600", marginTop: "4px" }}>
            Vehicle Mappings in DB
          </div>
        </div>

        {/* Linked Products Card */}
        <div
          style={{
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderTop: "3px solid #7c3aed",
            borderRadius: "12px",
            padding: "18px 20px",
            boxShadow: "0 1px 3px rgba(0, 0, 0, 0.04)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
            <span style={{ fontSize: "11px", color: "#64748b", fontWeight: "700", letterSpacing: "0.05em", textTransform: "uppercase" }}>
              Linked Products
            </span>
            <div style={{ width: "34px", height: "34px", background: "#f5f3ff", color: "#7c3aed", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                <line x1="12" y1="22.08" x2="12" y2="12"></line>
              </svg>
            </div>
          </div>
          <div style={{ fontSize: "28px", fontWeight: "800", color: "#0f172a", lineHeight: "1.2" }}>
            {totalProducts.toLocaleString()}
          </div>
          <div style={{ fontSize: "12px", color: "#7c3aed", fontWeight: "600", marginTop: "4px" }}>
            Mapped Catalog Items
          </div>
        </div>

        {/* Storefront Search Volume Card */}
        <div
          style={{
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderTop: "3px solid #ea580c",
            borderRadius: "12px",
            padding: "18px 20px",
            boxShadow: "0 1px 3px rgba(0, 0, 0, 0.04)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
            <span style={{ fontSize: "11px", color: "#64748b", fontWeight: "700", letterSpacing: "0.05em", textTransform: "uppercase" }}>
              Storefront Search Volume
            </span>
            <div style={{ width: "34px", height: "34px", background: "#fff7ed", color: "#ea580c", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
            </div>
          </div>
          <div style={{ fontSize: "28px", fontWeight: "800", color: "#0f172a", lineHeight: "1.2" }}>
            {totalSearches.toLocaleString()}
          </div>
          <div style={{ fontSize: "12px", color: "#ea580c", fontWeight: "600", marginTop: "4px" }}>
            Logged Customer Queries
          </div>
        </div>
      </div>

      {/* Global Controls & Maintenance Cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: "18px",
          marginBottom: "24px",
        }}
      >
        {/* Merchant Support Desk Global Status Toggle Card */}
        <div
          style={{
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderTop: `3px solid ${isSupportOnline ? "#059669" : "#d97706"}`,
            borderRadius: "14px",
            padding: "20px 22px",
            boxShadow: "0 1px 3px rgba(0, 0, 0, 0.04)",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
              <div style={{ width: "30px", height: "30px", background: isSupportOnline ? "#ecfdf5" : "#fffbe6", color: isSupportOnline ? "#047857" : "#d97706", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                </svg>
              </div>
              <h2 style={{ margin: 0, fontSize: "16px", fontWeight: "800", color: "#0f172a" }}>
                Merchant Support Desk Status
              </h2>
            </div>
            <p style={{ margin: "0 0 16px", color: "#64748b", fontSize: "12px", lineHeight: "1.4" }}>
              Master Admin control switch to set Merchant Support online availability across all stores.
            </p>
          </div>

          <supportFetcher.Form method="post">
            <input type="hidden" name="intent" value="toggleSupportStatus" />
            <input type="hidden" name="currentSupportStatus" value={isSupportOnline ? "true" : "false"} />
            
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#f8fafc", padding: "12px 14px", borderRadius: "10px", border: "1px solid #cbd5e1" }}>
              <div>
                <strong style={{ fontSize: "13px", color: isSupportOnline ? "#15803d" : "#b45309", display: "block" }}>
                  Status: {isSupportOnline ? "🟢 ONLINE" : "🟡 OFFLINE"}
                </strong>
                <span style={{ fontSize: "11px", color: "#64748b" }}>
                  {isSupportOnline ? "Merchants see 'Online & Available'" : "Merchants see 'Offline - Leave Message'"}
                </span>
              </div>

              <button
                type="submit"
                disabled={isSupportSubmitting}
                style={{
                  height: "36px",
                  background: isSupportOnline ? "#d97706" : "#047857",
                  color: "#ffffff",
                  border: "none",
                  padding: "0 14px",
                  borderRadius: "8px",
                  fontSize: "12px",
                  fontWeight: "800",
                  cursor: isSupportSubmitting ? "not-allowed" : "pointer",
                  boxShadow: isSupportOnline ? "0 2px 6px rgba(217, 119, 6, 0.2)" : "0 2px 6px rgba(4, 120, 87, 0.2)",
                  transition: "all 0.15s ease-in-out",
                  whiteSpace: "nowrap",
                }}
              >
                {isSupportSubmitting ? "Updating..." : isSupportOnline ? "SET OFFLINE" : "SET ONLINE"}
              </button>
            </div>
          </supportFetcher.Form>
        </div>
        {/* Global Annual Discount Settings Card */}
        <div
          style={{
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: "14px",
            padding: "20px 22px",
            boxShadow: "0 1px 3px rgba(0, 0, 0, 0.04)",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
              <div style={{ width: "30px", height: "30px", background: "#ecfdf5", color: "#047857", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path>
                  <line x1="7" y1="7" x2="7.01" y2="7"></line>
                </svg>
              </div>
              <h2 style={{ margin: 0, fontSize: "16px", fontWeight: "800", color: "#0f172a" }}>
                Global Default Discount
              </h2>
            </div>
            <p style={{ margin: "0 0 16px", color: "#64748b", fontSize: "12px", lineHeight: "1.4" }}>
              Set the default annual billing discount rate applied to all merchant accounts without a custom discount.
            </p>
          </div>

          <discountFetcher.Form method="post">
            <input type="hidden" name="intent" value="saveGlobalDiscount" />
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <div style={{ display: "flex", borderRadius: "8px", border: "1px solid #cbd5e1", overflow: "hidden", height: "38px" }}>
                <input
                  id="globalDiscountPercent"
                  type="number"
                  name="globalDiscountPercent"
                  min="0"
                  max="95"
                  value={globalDiscountInput}
                  onChange={(e) => setGlobalDiscountInput(e.target.value)}
                  style={{
                    width: "70px",
                    border: "none",
                    padding: "0 10px",
                    fontSize: "14px",
                    fontWeight: "800",
                    color: "#0f172a",
                    outline: "none",
                    textAlign: "center",
                    boxSizing: "border-box",
                  }}
                />
                <div
                  style={{
                    background: "#f1f5f9",
                    padding: "0 12px",
                    display: "flex",
                    alignItems: "center",
                    fontSize: "12px",
                    fontWeight: "700",
                    color: "#475569",
                    borderLeft: "1px solid #cbd5e1",
                  }}
                >
                  % OFF
                </div>
              </div>

              <button
                type="submit"
                disabled={isDiscountSubmitting}
                style={{
                  height: "38px",
                  background: isDiscountSubmitting ? "#94a3b8" : "#047857",
                  color: "#ffffff",
                  border: "none",
                  padding: "0 18px",
                  borderRadius: "8px",
                  fontSize: "13px",
                  fontWeight: "700",
                  cursor: isDiscountSubmitting ? "not-allowed" : "pointer",
                  boxShadow: "0 2px 6px rgba(4, 120, 87, 0.15)",
                  transition: "all 0.15s ease-in-out",
                  whiteSpace: "nowrap",
                }}
              >
                {isDiscountSubmitting ? "Updating..." : "Save Discount"}
              </button>
            </div>
          </discountFetcher.Form>
        </div>

        {/* System Diagnostics & Operations Card */}
        <div
          style={{
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: "14px",
            padding: "20px 22px",
            boxShadow: "0 1px 3px rgba(0, 0, 0, 0.04)",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
              <div style={{ width: "30px", height: "30px", background: "#f1f5f9", color: "#475569", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3"></circle>
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                </svg>
              </div>
              <h2 style={{ margin: 0, fontSize: "16px", fontWeight: "800", color: "#0f172a" }}>
                System Maintenance & Tools
              </h2>
            </div>
            <p style={{ margin: "0 0 16px", color: "#64748b", fontSize: "12px", lineHeight: "1.4" }}>
              Perform global database cleanup and optimize search indexing logs.
            </p>
          </div>

          <logsFetcher.Form method="post">
            <input type="hidden" name="intent" value="clearLogs" />
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <div
                style={{
                  flex: 1,
                  height: "38px",
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  padding: "0 12px",
                  borderRadius: "8px",
                  fontSize: "12px",
                  color: "#475569",
                  fontWeight: "600",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  boxSizing: "border-box",
                }}
              >
                <span>Logged Queries:</span>
                <strong style={{ color: "#0f172a", fontWeight: "800" }}>{totalSearches.toLocaleString()}</strong>
              </div>

              <button
                type="submit"
                disabled={isLogsSubmitting || totalSearches === 0}
                style={{
                  height: "38px",
                  background: isLogsSubmitting || totalSearches === 0 ? "#cbd5e1" : "#ef4444",
                  color: "#ffffff",
                  border: "none",
                  padding: "0 18px",
                  borderRadius: "8px",
                  fontSize: "13px",
                  fontWeight: "700",
                  cursor: isLogsSubmitting || totalSearches === 0 ? "not-allowed" : "pointer",
                  boxShadow: totalSearches > 0 ? "0 2px 6px rgba(239, 68, 68, 0.15)" : "none",
                  transition: "all 0.15s ease-in-out",
                  whiteSpace: "nowrap",
                }}
              >
                {isLogsSubmitting ? "Clearing..." : "Purge Search Logs"}
              </button>
            </div>
          </logsFetcher.Form>
        </div>
      </div>

      {/* Installed Merchant Accounts Table Card */}
      <div
        style={{
          background: "#ffffff",
          border: "1px solid #e2e8f0",
          borderRadius: "14px",
          padding: "20px 22px",
          boxShadow: "0 1px 3px rgba(0, 0, 0, 0.04)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "16px",
            marginBottom: "18px",
          }}
        >
          <div>
            <h2 style={{ margin: "0 0 2px", fontSize: "18px", fontWeight: "800", color: "#0f172a" }}>
              Installed Merchant Accounts ({shopsList.length})
            </h2>
            <p style={{ margin: 0, color: "#64748b", fontSize: "12px" }}>
              Set custom user-specific discounts per store. Discounts dynamically reflect on each merchant&apos;s plan page.
            </p>
          </div>

          {/* Search Filter */}
          <div style={{ position: "relative", width: "260px" }}>
            <div
              style={{
                position: "absolute",
                left: "10px",
                top: "50%",
                transform: "translateY(-50%)",
                color: "#94a3b8",
                display: "flex",
                alignItems: "center",
                pointerEvents: "none",
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
            </div>
            <input
              type="text"
              placeholder="Search store domain or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: "100%",
                height: "36px",
                paddingLeft: "32px",
                paddingRight: "12px",
                borderRadius: "8px",
                border: "1px solid #cbd5e1",
                fontSize: "12px",
                outline: "none",
                boxSizing: "border-box",
                color: "#0f172a",
              }}
            />
          </div>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "13px" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #e2e8f0", background: "#f8fafc" }}>
                <th style={{ padding: "10px 14px", color: "#64748b", fontWeight: "700", fontSize: "11px", letterSpacing: "0.04em", textTransform: "uppercase" }}>Merchant Store Domain</th>
                <th style={{ padding: "10px 14px", color: "#64748b", fontWeight: "700", fontSize: "11px", letterSpacing: "0.04em", textTransform: "uppercase" }}>Contact Email</th>
                <th style={{ padding: "10px 14px", color: "#64748b", fontWeight: "700", fontSize: "11px", letterSpacing: "0.04em", textTransform: "uppercase" }}>Active Plan</th>
                <th style={{ padding: "10px 14px", textAlign: "center", color: "#64748b", fontWeight: "700", fontSize: "11px", letterSpacing: "0.04em", textTransform: "uppercase" }}>Fitment Stats</th>
                <th style={{ padding: "10px 14px", color: "#64748b", fontWeight: "700", fontSize: "11px", letterSpacing: "0.04em", textTransform: "uppercase", minWidth: "260px" }}>
                  User Discount Option (%)
                </th>
                <th style={{ padding: "10px 14px", textAlign: "center", color: "#64748b", fontWeight: "700", fontSize: "11px", letterSpacing: "0.04em", textTransform: "uppercase" }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredShops.length === 0 ? (
                <tr>
                  <td colSpan="6" style={{ padding: "28px", textAlign: "center", color: "#94a3b8" }}>
                    No matching merchant accounts found.
                  </td>
                </tr>
              ) : (
                filteredShops.map((merchant) => {
                  const isCurrent = merchant.shop === currentShop;
                  const currentInputValue =
                    userDiscountInputs[merchant.shop] ?? merchant.merchantDiscountPercent;

                  return (
                    <tr
                      key={merchant.shop}
                      style={{
                        borderBottom: "1px solid #f1f5f9",
                        background: isCurrent ? "#f0fdf4" : "transparent",
                      }}
                    >
                      {/* Shop Domain */}
                      <td style={{ padding: "12px 14px", verticalAlign: "middle" }}>
                        <div style={{ fontWeight: "700", color: "#0f172a", fontSize: "13px" }}>
                          {merchant.shop}
                        </div>
                        <div style={{ display: "flex", gap: "6px", marginTop: "4px", flexWrap: "wrap" }}>
                          {isCurrent && (
                            <span
                              style={{
                                background: "#047857",
                                color: "#ffffff",
                                padding: "2px 6px",
                                borderRadius: "4px",
                                fontSize: "10px",
                                fontWeight: "800",
                                letterSpacing: "0.02em",
                              }}
                            >
                              SUPER ADMIN
                            </span>
                          )}
                          {merchant.isCustomDiscount ? (
                            <span
                              style={{
                                background: "#fef3c7",
                                color: "#b45309",
                                border: "1px solid #fde68a",
                                padding: "2px 6px",
                                borderRadius: "4px",
                                fontSize: "10px",
                                fontWeight: "700",
                              }}
                            >
                              MERCHANT VIP ({merchant.merchantDiscountPercent}% EXTRA OFF)
                            </span>
                          ) : (
                            <span
                              style={{
                                background: "#f1f5f9",
                                color: "#64748b",
                                padding: "2px 6px",
                                borderRadius: "4px",
                                fontSize: "10px",
                                fontWeight: "600",
                              }}
                            >
                              STANDARD (0% EXTRA DISCOUNT)
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Contact Email */}
                      <td style={{ padding: "12px 14px", color: "#334155", fontWeight: "500", verticalAlign: "middle", fontSize: "13px" }}>
                        {merchant.email}
                      </td>

                      {/* Active Plan */}
                      <td style={{ padding: "12px 14px", verticalAlign: "middle" }}>
                        <span
                          style={{
                            background: "#eff6ff",
                            color: "#1e40af",
                            border: "1px solid #bfdbfe",
                            padding: "3px 8px",
                            borderRadius: "6px",
                            fontSize: "11px",
                            fontWeight: "700",
                            display: "inline-block",
                          }}
                        >
                          {merchant.activePlan}
                        </span>
                      </td>

                      {/* Fitment Stats */}
                      <td style={{ padding: "12px 14px", textAlign: "center", verticalAlign: "middle" }}>
                        <div style={{ fontSize: "12px", fontWeight: "700", color: "#0f172a" }}>
                          {merchant.fitments} Records
                        </div>
                        <div style={{ fontSize: "11px", color: "#64748b", marginTop: "2px" }}>
                          {merchant.mappings} Maps &bull; {merchant.searches} Searches
                        </div>
                      </td>

                      {/* User Specific Discount Option */}
                      <td style={{ padding: "12px 14px", verticalAlign: "middle" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <userDiscountFetcher.Form method="post" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <input type="hidden" name="intent" value="saveUserDiscount" />
                            <input type="hidden" name="targetShop" value={merchant.shop} />

                            <input
                              type="number"
                              name="userDiscountPercent"
                              min="0"
                              max="95"
                              value={currentInputValue}
                              onChange={(e) =>
                                handleUserDiscountChange(merchant.shop, e.target.value)
                              }
                              style={{
                                width: "52px",
                                height: "32px",
                                padding: "0 4px",
                                borderRadius: "6px",
                                border: merchant.isCustomDiscount
                                  ? "2px solid #f59e0b"
                                  : "1px solid #cbd5e1",
                                fontSize: "12px",
                                fontWeight: "800",
                                textAlign: "center",
                                outline: "none",
                                boxSizing: "border-box",
                              }}
                            />

                            <span style={{ fontSize: "12px", fontWeight: "700", color: "#475569" }}>%</span>

                            <button
                              type="submit"
                              disabled={isUserDiscountSubmitting}
                              style={{
                                height: "32px",
                                background: "#047857",
                                color: "#ffffff",
                                border: "none",
                                padding: "0 12px",
                                borderRadius: "6px",
                                fontSize: "11px",
                                fontWeight: "700",
                                cursor: "pointer",
                                transition: "background 0.15s ease-in-out",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {isUserDiscountSubmitting ? "Saving..." : "Save Discount"}
                            </button>
                          </userDiscountFetcher.Form>

                          {merchant.isCustomDiscount && (
                            <userDiscountFetcher.Form method="post" style={{ display: "inline" }}>
                              <input type="hidden" name="intent" value="resetUserDiscount" />
                              <input type="hidden" name="targetShop" value={merchant.shop} />
                              <button
                                type="submit"
                                disabled={isUserDiscountSubmitting}
                                title="Reset to Global Default"
                                style={{
                                  height: "32px",
                                  background: "#f1f5f9",
                                  color: "#64748b",
                                  border: "1px solid #cbd5e1",
                                  padding: "0 8px",
                                  borderRadius: "6px",
                                  fontSize: "11px",
                                  fontWeight: "600",
                                  cursor: "pointer",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                Reset
                              </button>
                            </userDiscountFetcher.Form>
                          )}
                        </div>
                      </td>

                      {/* Status */}
                      <td style={{ padding: "12px 14px", textAlign: "center", verticalAlign: "middle" }}>
                        <span
                          style={{
                            background: "#ecfdf5",
                            color: "#047857",
                            border: "1px solid #a7f3d0",
                            padding: "3px 8px",
                            borderRadius: "20px",
                            fontSize: "11px",
                            fontWeight: "700",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                          }}
                        >
                          <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: "#047857" }}></span>
                          {merchant.status}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

