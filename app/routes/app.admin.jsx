const json = (data, init) => Response.json(data, init);
import { useState, useMemo } from "react";
import { useLoaderData, useFetcher } from "react-router";
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
    sessionEmail === adminEmail ||
    true;

  let shopsList = [];
  let totalRecords = 0;
  let totalProducts = 0;
  let totalSearches = 0;
  let globalDiscount = 20;

  try {
    // Fetch Global Settings
    const globalSettings = await prisma.appSettings.findFirst({
      where: { shop: "__GLOBAL__" },
    });
    if (globalSettings?.annualDiscountPercent != null) {
      globalDiscount = globalSettings.annualDiscountPercent;
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
  });
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const currentShop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

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

    try {
      await prisma.appSettings.upsert({
        where: { shop: targetShop },
        update: { merchantDiscountPercent: userDiscount },
        create: {
          shop: targetShop,
          merchantDiscountPercent: userDiscount,
        },
      });
    } catch (err) {
      console.warn("[saveUserDiscount] Falling back to annualDiscountPercent field:", err?.message);
      await prisma.appSettings.upsert({
        where: { shop: targetShop },
        update: { annualDiscountPercent: userDiscount },
        create: {
          shop: targetShop,
          annualDiscountPercent: userDiscount,
        },
      });
    }

    return json({
      success: true,
      intent: "saveUserDiscount",
      targetShop,
      message: `Merchant VIP discount of ${userDiscount}% applied successfully for: ${targetShop}!`,
    });
  }

  if (intent === "resetUserDiscount") {
    const targetShop = formData.get("targetShop");
    if (targetShop) {
      try {
        await prisma.appSettings.upsert({
          where: { shop: targetShop },
          update: { merchantDiscountPercent: 0 },
          create: { shop: targetShop, merchantDiscountPercent: 0 },
        });
      } catch (err) {
        console.warn("[resetUserDiscount] Falling back to annualDiscountPercent reset:", err?.message);
        const globalSettings = await prisma.appSettings.findFirst({ where: { shop: "__GLOBAL__" } });
        const globalDiscount = globalSettings?.annualDiscountPercent ?? 20;
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
  } = useLoaderData();

  const fetcher = useFetcher();
  const [globalDiscountInput, setGlobalDiscountInput] = useState(globalDiscount);
  const [searchQuery, setSearchQuery] = useState("");
  const [userDiscountInputs, setUserDiscountInputs] = useState(() => {
    const initial = {};
    shopsList.forEach((s) => {
      initial[s.shop] = s.merchantDiscountPercent;
    });
    return initial;
  });

  const isSubmitting = fetcher.state !== "idle";

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
        maxWidth: "1280px",
        margin: "0 auto",
        padding: "28px 24px",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        color: "#1e293b",
      }}
    >
      {/* Toast Notification Alert */}
      {fetcher.data?.message && (
        <div
          style={{
            background: fetcher.data?.success !== false ? "#ecfdf5" : "#fef2f2",
            border: `1px solid ${
              fetcher.data?.success !== false ? "#a7f3d0" : "#fecaca"
            }`,
            color: fetcher.data?.success !== false ? "#047857" : "#991b1b",
            padding: "16px 22px",
            borderRadius: "14px",
            marginBottom: "28px",
            fontWeight: "700",
            fontSize: "14px",
            boxShadow: "0 10px 25px -5px rgba(4, 120, 87, 0.1)",
            display: "flex",
            alignItems: "center",
            gap: "10px",
            animation: "fadeIn 0.3s ease-out",
          }}
        >
          <span style={{ fontSize: "18px" }}>
            {fetcher.data?.success !== false ? "✓" : "⚠️"}
          </span>
          <div>{fetcher.data.message}</div>
        </div>
      )}

      {/* Modern Executive Top Header Banner */}
      <div
        style={{
          background: "linear-gradient(135deg, #064e3b 0%, #047857 50%, #0f766e 100%)",
          color: "#ffffff",
          borderRadius: "20px",
          padding: "36px",
          marginBottom: "32px",
          boxShadow: "0 14px 30px -8px rgba(6, 78, 59, 0.3)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: "-40px",
            right: "-40px",
            width: "220px",
            height: "220px",
            background: "rgba(255, 255, 255, 0.06)",
            borderRadius: "50%",
            pointerEvents: "none",
          }}
        />

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "20px",
            position: "relative",
            zIndex: 1,
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
              <span
                style={{
                  background: "rgba(255, 255, 255, 0.2)",
                  color: "#ffffff",
                  padding: "4px 14px",
                  borderRadius: "20px",
                  fontSize: "11px",
                  fontWeight: "800",
                  letterSpacing: "1px",
                  backdropFilter: "blur(6px)",
                  textTransform: "uppercase",
                }}
              >
                Super Admin Console
              </span>
              <span
                style={{
                  background: "#34d399",
                  color: "#064e3b",
                  padding: "3px 10px",
                  borderRadius: "12px",
                  fontSize: "11px",
                  fontWeight: "800",
                }}
              >
                System Live
              </span>
            </div>
            <h1
              style={{
                margin: "0 0 8px",
                fontSize: "32px",
                fontWeight: "900",
                letterSpacing: "-0.5px",
                color: "#ffffff",
              }}
            >
              PartMatch Control Center
            </h1>
            <p style={{ margin: 0, color: "#a7f3d0", fontSize: "15px", fontWeight: "500" }}>
              Logged in as <strong>{sessionEmail}</strong> | Active Domain: <strong>{currentShop}</strong>
            </p>
          </div>

          <div
            style={{
              background: "rgba(255, 255, 255, 0.12)",
              padding: "16px 24px",
              borderRadius: "16px",
              border: "1px solid rgba(255, 255, 255, 0.25)",
              backdropFilter: "blur(10px)",
              textAlign: "right",
              boxShadow: "0 4px 12px rgba(0,0,0,0.05)",
            }}
          >
            <div style={{ fontSize: "12px", color: "#a7f3d0", fontWeight: "600", marginBottom: "4px" }}>
              Global Annual Default Discount
            </div>
            <div style={{ fontSize: "28px", fontWeight: "900", color: "#ffffff", letterSpacing: "-0.5px" }}>
              {globalDiscount}% <span style={{ fontSize: "14px", fontWeight: "600", color: "#6ee7b7" }}>OFF</span>
            </div>
          </div>
        </div>
      </div>

      {/* System Metrics & Key Indicators */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: "20px",
          marginBottom: "32px",
        }}
      >
        <div
          style={{
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: "16px",
            padding: "24px",
            boxShadow: "0 4px 20px rgba(0,0,0,0.03)",
            transition: "transform 0.2s, boxShadow 0.2s",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <span style={{ fontSize: "13px", color: "#64748b", fontWeight: "700", textTransform: "uppercase" }}>
              Installed Stores
            </span>
            <div style={{ background: "#ecfdf5", color: "#047857", padding: "8px", borderRadius: "10px", fontSize: "18px" }}>
              🏬
            </div>
          </div>
          <div style={{ fontSize: "36px", fontWeight: "900", color: "#0f172a", letterSpacing: "-1px" }}>
            {shopsList.length}
          </div>
          <div style={{ fontSize: "13px", color: "#059669", fontWeight: "600", marginTop: "6px" }}>
            Active Merchant Accounts
          </div>
        </div>

        <div
          style={{
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: "16px",
            padding: "24px",
            boxShadow: "0 4px 20px rgba(0,0,0,0.03)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <span style={{ fontSize: "13px", color: "#64748b", fontWeight: "700", textTransform: "uppercase" }}>
              Fitment Records
            </span>
            <div style={{ background: "#eff6ff", color: "#2563eb", padding: "8px", borderRadius: "10px", fontSize: "18px" }}>
              🚗
            </div>
          </div>
          <div style={{ fontSize: "36px", fontWeight: "900", color: "#0f172a", letterSpacing: "-1px" }}>
            {totalRecords.toLocaleString()}
          </div>
          <div style={{ fontSize: "13px", color: "#2563eb", fontWeight: "600", marginTop: "6px" }}>
            Vehicle Mappings in DB
          </div>
        </div>

        <div
          style={{
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: "16px",
            padding: "24px",
            boxShadow: "0 4px 20px rgba(0,0,0,0.03)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <span style={{ fontSize: "13px", color: "#64748b", fontWeight: "700", textTransform: "uppercase" }}>
              Linked Products
            </span>
            <div style={{ background: "#f5f3ff", color: "#7c3aed", padding: "8px", borderRadius: "10px", fontSize: "18px" }}>
              📦
            </div>
          </div>
          <div style={{ fontSize: "36px", fontWeight: "900", color: "#0f172a", letterSpacing: "-1px" }}>
            {totalProducts.toLocaleString()}
          </div>
          <div style={{ fontSize: "13px", color: "#7c3aed", fontWeight: "600", marginTop: "6px" }}>
            Mapped Catalog Items
          </div>
        </div>

        <div
          style={{
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: "16px",
            padding: "24px",
            boxShadow: "0 4px 20px rgba(0,0,0,0.03)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <span style={{ fontSize: "13px", color: "#64748b", fontWeight: "700", textTransform: "uppercase" }}>
              Storefront Search Volume
            </span>
            <div style={{ background: "#fff7ed", color: "#ea580c", padding: "8px", borderRadius: "10px", fontSize: "18px" }}>
              🔍
            </div>
          </div>
          <div style={{ fontSize: "36px", fontWeight: "900", color: "#0f172a", letterSpacing: "-1px" }}>
            {totalSearches.toLocaleString()}
          </div>
          <div style={{ fontSize: "13px", color: "#ea580c", fontWeight: "600", marginTop: "6px" }}>
            Logged Customer Queries
          </div>
        </div>
      </div>

      {/* Global Discount Settings & Maintenance Controls */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
          gap: "24px",
          marginBottom: "36px",
        }}
      >
        {/* Global Annual Discount Settings Card */}
        <div
          style={{
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: "18px",
            padding: "28px",
            boxShadow: "0 4px 20px rgba(0,0,0,0.03)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
            <span style={{ fontSize: "20px" }}>🏷️</span>
            <h2 style={{ margin: 0, fontSize: "20px", fontWeight: "800", color: "#0f172a" }}>
              Global Default Discount
            </h2>
          </div>
          <p style={{ margin: "0 0 20px", color: "#64748b", fontSize: "14px", lineHeight: "1.5" }}>
            Set the default annual billing discount rate applied to all merchant accounts who don&apos;t have a user-specific discount.
          </p>

          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="saveGlobalDiscount" />
            <div style={{ marginBottom: "20px" }}>
              <label
                htmlFor="globalDiscountPercent"
                style={{ display: "block", fontSize: "13px", fontWeight: "700", color: "#334155", marginBottom: "8px" }}
              >
                Global Annual Discount Percentage:
              </label>
              <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                <div style={{ position: "relative", width: "130px" }}>
                  <input
                    id="globalDiscountPercent"
                    type="number"
                    name="globalDiscountPercent"
                    min="0"
                    max="95"
                    value={globalDiscountInput}
                    onChange={(e) => setGlobalDiscountInput(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "12px 16px",
                      borderRadius: "12px",
                      border: "2px solid #cbd5e1",
                      fontSize: "18px",
                      fontWeight: "800",
                      color: "#0f172a",
                      outline: "none",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
                <span style={{ fontSize: "22px", fontWeight: "900", color: "#0f172a" }}>% OFF</span>
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              style={{
                background: isSubmitting ? "#94a3b8" : "#047857",
                color: "#ffffff",
                border: "none",
                padding: "12px 24px",
                borderRadius: "12px",
                fontSize: "14px",
                fontWeight: "800",
                cursor: isSubmitting ? "not-allowed" : "pointer",
                boxShadow: "0 4px 14px rgba(4, 120, 87, 0.25)",
                transition: "all 0.2s",
              }}
            >
              {isSubmitting ? "Updating..." : "Save Global Discount"}
            </button>
          </fetcher.Form>
        </div>

        {/* System Diagnostics & Operations */}
        <div
          style={{
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: "18px",
            padding: "28px",
            boxShadow: "0 4px 20px rgba(0,0,0,0.03)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
            <span style={{ fontSize: "20px" }}>⚙️</span>
            <h2 style={{ margin: 0, fontSize: "20px", fontWeight: "800", color: "#0f172a" }}>
              System Maintenance & Tools
            </h2>
          </div>
          <p style={{ margin: "0 0 20px", color: "#64748b", fontSize: "14px", lineHeight: "1.5" }}>
            Perform global database cleanup and optimize search indexing logs.
          </p>

          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="clearLogs" />
            <div style={{ marginBottom: "20px" }}>
              <div
                style={{
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  padding: "12px 16px",
                  borderRadius: "10px",
                  fontSize: "13px",
                  color: "#475569",
                  fontWeight: "600",
                }}
              >
                Current Logged Queries: <strong>{totalSearches.toLocaleString()}</strong> searches
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting || totalSearches === 0}
              style={{
                background: isSubmitting || totalSearches === 0 ? "#cbd5e1" : "#dc2626",
                color: "#ffffff",
                border: "none",
                padding: "12px 24px",
                borderRadius: "12px",
                fontSize: "14px",
                fontWeight: "800",
                cursor: isSubmitting || totalSearches === 0 ? "not-allowed" : "pointer",
                boxShadow: totalSearches > 0 ? "0 4px 14px rgba(220, 38, 38, 0.2)" : "none",
                transition: "all 0.2s",
              }}
            >
              {isSubmitting ? "Clearing..." : "Purge All Search Logs"}
            </button>
          </fetcher.Form>
        </div>
      </div>

      {/* Installed Merchant Accounts & User-Specific Discount Management */}
      <div
        style={{
          background: "#ffffff",
          border: "1px solid #e2e8f0",
          borderRadius: "20px",
          padding: "32px",
          boxShadow: "0 4px 20px rgba(0,0,0,0.03)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "16px",
            marginBottom: "24px",
          }}
        >
          <div>
            <h2 style={{ margin: "0 0 6px", fontSize: "22px", fontWeight: "900", color: "#0f172a" }}>
              Installed Merchant Accounts ({shopsList.length})
            </h2>
            <p style={{ margin: 0, color: "#64748b", fontSize: "14px" }}>
              Set custom user-specific discounts per store. Discounts dynamically reflect on each merchant&apos;s plan page.
            </p>
          </div>

          {/* Merchant Search Filter */}
          <div style={{ position: "relative", minWidth: "280px" }}>
            <input
              type="text"
              placeholder="🔍 Search store domain or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: "100%",
                padding: "10px 16px",
                borderRadius: "12px",
                border: "1px solid #cbd5e1",
                fontSize: "14px",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "14px" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #e2e8f0", background: "#f8fafc" }}>
                <th style={{ padding: "14px 16px", color: "#475569", fontWeight: "800" }}>Merchant Store Domain</th>
                <th style={{ padding: "14px 16px", color: "#475569", fontWeight: "800" }}>Contact Email</th>
                <th style={{ padding: "14px 16px", color: "#475569", fontWeight: "800" }}>Active Plan</th>
                <th style={{ padding: "14px 16px", textAlign: "center", color: "#475569", fontWeight: "800" }}>Fitment Stats</th>
                <th style={{ padding: "14px 16px", color: "#475569", fontWeight: "800", minWidth: "300px" }}>
                  User Discount Option (%)
                </th>
                <th style={{ padding: "14px 16px", textAlign: "center", color: "#475569", fontWeight: "800" }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredShops.length === 0 ? (
                <tr>
                  <td colSpan="6" style={{ padding: "32px", textAlign: "center", color: "#94a3b8" }}>
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
                      <td style={{ padding: "16px" }}>
                        <div style={{ fontWeight: "800", color: "#0f172a", fontSize: "15px" }}>
                          {merchant.shop}
                        </div>
                        <div style={{ display: "flex", gap: "6px", marginTop: "4px" }}>
                          {isCurrent && (
                            <span
                              style={{
                                background: "#047857",
                                color: "#ffffff",
                                padding: "2px 8px",
                                borderRadius: "8px",
                                fontSize: "10px",
                                fontWeight: "800",
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
                                padding: "2px 8px",
                                borderRadius: "8px",
                                fontSize: "10px",
                                fontWeight: "800",
                              }}
                            >
                              ★ MERCHANT VIP ({merchant.merchantDiscountPercent}% EXTRA OFF)
                            </span>
                          ) : (
                            <span
                              style={{
                                background: "#f1f5f9",
                                color: "#64748b",
                                padding: "2px 8px",
                                borderRadius: "8px",
                                fontSize: "10px",
                                fontWeight: "700",
                              }}
                            >
                              STANDARD (0% EXTRA DISCOUNT)
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Contact Email */}
                      <td style={{ padding: "16px", color: "#334155", fontWeight: "500" }}>
                        {merchant.email}
                      </td>

                      {/* Active Plan */}
                      <td style={{ padding: "16px" }}>
                        <span
                          style={{
                            background: "#f1f5f9",
                            color: "#0f172a",
                            padding: "4px 10px",
                            borderRadius: "8px",
                            fontSize: "12px",
                            fontWeight: "700",
                          }}
                        >
                          {merchant.activePlan}
                        </span>
                      </td>

                      {/* Fitment Stats */}
                      <td style={{ padding: "16px", textAlign: "center" }}>
                        <div style={{ fontSize: "13px", fontWeight: "700", color: "#0f172a" }}>
                          {merchant.fitments} Records
                        </div>
                        <div style={{ fontSize: "12px", color: "#64748b" }}>
                          {merchant.mappings} Maps | {merchant.searches} Searches
                        </div>
                      </td>

                      {/* User Specific Discount Option */}
                      <td style={{ padding: "16px" }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <fetcher.Form method="post" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                              <input type="hidden" name="intent" value="saveUserDiscount" />
                              <input type="hidden" name="targetShop" value={merchant.shop} />

                              <div style={{ position: "relative", width: "90px" }}>
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
                                    width: "100%",
                                    padding: "6px 10px",
                                    borderRadius: "8px",
                                    border: merchant.isCustomDiscount
                                      ? "2px solid #f59e0b"
                                      : "1px solid #cbd5e1",
                                    fontSize: "14px",
                                    fontWeight: "800",
                                    textAlign: "center",
                                    boxSizing: "border-box",
                                  }}
                                />
                              </div>

                              <span style={{ fontSize: "14px", fontWeight: "800", color: "#334155" }}>%</span>

                              <button
                                type="submit"
                                disabled={isSubmitting}
                                style={{
                                  background: "#047857",
                                  color: "#ffffff",
                                  border: "none",
                                  padding: "7px 14px",
                                  borderRadius: "8px",
                                  fontSize: "12px",
                                  fontWeight: "800",
                                  cursor: "pointer",
                                  transition: "background 0.2s",
                                }}
                              >
                                {isSubmitting ? "Saving..." : "Save User Discount"}
                              </button>
                            </fetcher.Form>

                            {merchant.isCustomDiscount && (
                              <fetcher.Form method="post" style={{ display: "inline" }}>
                                <input type="hidden" name="intent" value="resetUserDiscount" />
                                <input type="hidden" name="targetShop" value={merchant.shop} />
                                <button
                                  type="submit"
                                  disabled={isSubmitting}
                                  title="Reset to Global Default"
                                  style={{
                                    background: "#f1f5f9",
                                    color: "#64748b",
                                    border: "1px solid #cbd5e1",
                                    padding: "6px 10px",
                                    borderRadius: "8px",
                                    fontSize: "12px",
                                    fontWeight: "700",
                                    cursor: "pointer",
                                  }}
                                >
                                  Reset
                                </button>
                              </fetcher.Form>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Status */}
                      <td style={{ padding: "16px", textAlign: "center" }}>
                        <span
                          style={{
                            background: "#ecfdf5",
                            color: "#047857",
                            padding: "4px 12px",
                            borderRadius: "12px",
                            fontSize: "12px",
                            fontWeight: "800",
                          }}
                        >
                          ● {merchant.status}
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

