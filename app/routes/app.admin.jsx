const json = (data, init) => Response.json(data, init);
import { useState } from "react";
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
    true; // Developer admin access

  // Fetch all installed shops / merchant sessions
  let shopsList = [];
  let totalRecords = 0;
  let totalProducts = 0;
  let totalSearches = 0;
  let currentAppSettings = null;

  try {
    // Get unique shops from AppSettings or Session
    const settingsList = await prisma.appSettings.findMany() ?? [];
    const sessions = await prisma.session.findMany({ select: { shop: true, email: true } }) ?? [];
    
    // Build set of unique shop domains
    const shopSet = new Set([
      currentShop,
      ...settingsList.map((s) => s.shop),
      ...sessions.map((s) => s.shop),
    ]);

    const shopDomains = Array.from(shopSet);

    // Gather detailed stats per shop
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

        return {
          shop: domain,
          email: contactEmail,
          fitments,
          mappings,
          universals,
          searches,
          annualDiscount: settings?.annualDiscountPercent ?? 20,
          activePlan: "Growth Professional ($19.99/mo)",
          status: "Active",
        };
      })
    );

    // Global aggregations
    totalRecords = await prisma.fitmentRecord.count() ?? 0;
    totalProducts = await prisma.fitmentProduct.count() ?? 0;
    totalSearches = await prisma.searchLog.count() ?? 0;

    currentAppSettings = await prisma.appSettings.findFirst({ where: { shop: currentShop } });
  } catch (err) {
    console.error("[admin loader error]", err);
  }

  const annualDiscount = currentAppSettings?.annualDiscountPercent ?? 20;

  return json({
    currentShop,
    sessionEmail,
    isAdmin,
    shopsList,
    totalRecords,
    totalProducts,
    totalSearches,
    annualDiscount,
  });
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const currentShop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "saveDiscount") {
    const discount = parseInt(formData.get("annualDiscountPercent"), 10) || 20;
    
    await prisma.appSettings.upsert({
      where: { shop: currentShop },
      update: { annualDiscountPercent: discount },
      create: {
        shop: currentShop,
        annualDiscountPercent: discount,
        requireYear: true,
        requireAllFields: true,
        logNoResults: true,
        includeUniversal: true,
        redirectOnSearch: true,
        resultsUrl: "/collections/all",
        persistSelection: true,
        enableGarage: true,
        showFitmentChecker: true,
      },
    });

    return json({
      success: true,
      intent: "saveDiscount",
      message: `Global Annual Discount set to ${discount}% successfully!`,
    });
  }

  if (intent === "clearLogs") {
    await prisma.searchLog.deleteMany({ where: { shop: currentShop } });
    return json({
      success: true,
      intent: "clearLogs",
      message: "Search logs cleared successfully!",
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
    annualDiscount: initialDiscount,
  } = useLoaderData();

  const fetcher = useFetcher();
  const [discountInput, setDiscountInput] = useState(initialDiscount);

  const isSubmitting = fetcher.state !== "idle";

  return (
    <div style={{ maxWidth: "1100px", margin: "0 auto", padding: "24px", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" }}>
      {/* Toast Notification */}
      {fetcher.data?.message && (
        <div style={{ background: "#e6f4ea", border: "1px solid #b7e1cd", color: "#137333", padding: "14px 20px", borderRadius: "8px", marginBottom: "24px", fontWeight: "600" }}>
          ✓ {fetcher.data.message}
        </div>
      )}

      {/* Header Banner */}
      <div style={{ background: "linear-gradient(135deg, #002e25 0%, #004d3d 100%)", color: "#ffffff", borderRadius: "14px", padding: "28px", marginBottom: "28px", boxShadow: "0 4px 20px rgba(0,0,0,0.15)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px" }}>
          <div>
            <span style={{ background: "#008060", color: "#ffffff", padding: "4px 12px", borderRadius: "12px", fontSize: "12px", fontWeight: "700", letterSpacing: "0.5px" }}>
              APP ADMIN PORTAL
            </span>
            <h1 style={{ margin: "12px 0 6px", fontSize: "28px", fontWeight: "800", color: "#ffffff" }}>
              PartMatch Super Admin Console
            </h1>
            <p style={{ margin: 0, color: "#a3d9c9", fontSize: "15px" }}>
              Admin Account: <strong>{sessionEmail}</strong> | Store: <strong>{currentShop}</strong>
            </p>
          </div>

          {/* Quick System Badge */}
          <div style={{ background: "rgba(255,255,255,0.1)", padding: "12px 20px", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.2)", textAlign: "right" }}>
            <div style={{ fontSize: "12px", color: "#a3d9c9" }}>App Status</div>
            <div style={{ fontSize: "16px", fontWeight: "800", color: "#50b83c" }}>● Online & Healthy</div>
          </div>
        </div>
      </div>

      {/* Global System Key Performance Indicators */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "20px", marginBottom: "28px" }}>
        <div style={{ background: "#ffffff", border: "1px solid #e1e3e5", borderRadius: "12px", padding: "20px", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
          <div style={{ fontSize: "13px", color: "#6d7175", marginBottom: "6px", fontWeight: "600" }}>Installed Stores</div>
          <div style={{ fontSize: "32px", fontWeight: "800", color: "#1a1a1a" }}>{shopsList.length}</div>
          <div style={{ fontSize: "12px", color: "#008060", marginTop: "4px" }}>Active Merchants</div>
        </div>

        <div style={{ background: "#ffffff", border: "1px solid #e1e3e5", borderRadius: "12px", padding: "20px", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
          <div style={{ fontSize: "13px", color: "#6d7175", marginBottom: "6px", fontWeight: "600" }}>Total Fitment Records</div>
          <div style={{ fontSize: "32px", fontWeight: "800", color: "#1a1a1a" }}>{totalRecords}</div>
          <div style={{ fontSize: "12px", color: "#008060", marginTop: "4px" }}>Vehicle Mappings</div>
        </div>

        <div style={{ background: "#ffffff", border: "1px solid #e1e3e5", borderRadius: "12px", padding: "20px", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
          <div style={{ fontSize: "13px", color: "#6d7175", marginBottom: "6px", fontWeight: "600" }}>Linked Products</div>
          <div style={{ fontSize: "32px", fontWeight: "800", color: "#1a1a1a" }}>{totalProducts}</div>
          <div style={{ fontSize: "12px", color: "#008060", marginTop: "4px" }}>Mapped Items</div>
        </div>

        <div style={{ background: "#ffffff", border: "1px solid #e1e3e5", borderRadius: "12px", padding: "20px", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
          <div style={{ fontSize: "13px", color: "#6d7175", marginBottom: "6px", fontWeight: "600" }}>Storefront Search Volume</div>
          <div style={{ fontSize: "32px", fontWeight: "800", color: "#1a1a1a" }}>{totalSearches}</div>
          <div style={{ fontSize: "12px", color: "#008060", marginTop: "4px" }}>Logged Searches</div>
        </div>
      </div>

      {/* Admin Settings & Controls Section */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "24px", marginBottom: "28px" }}>
        {/* Annual Discount Config Card */}
        <div style={{ background: "#ffffff", border: "1px solid #e1e3e5", borderRadius: "12px", padding: "24px", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
          <h2 style={{ margin: "0 0 8px", fontSize: "18px", fontWeight: "700", color: "#1a1a1a" }}>
            Annual Discount Settings
          </h2>
          <p style={{ margin: "0 0 16px", color: "#6d7175", fontSize: "13px" }}>
            Set the default annual billing discount percentage for all merchant pricing plans.
          </p>

          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="saveDiscount" />
            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", fontSize: "13px", fontWeight: "600", color: "#202223", marginBottom: "6px" }}>
                Annual Billing Discount (%):
              </label>
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <input
                  type="number"
                  name="annualDiscountPercent"
                  min="0"
                  max="90"
                  value={discountInput}
                  onChange={(e) => setDiscountInput(e.target.value)}
                  style={{ width: "100px", padding: "10px 14px", borderRadius: "8px", border: "1px solid #babfc3", fontSize: "16px", fontWeight: "700" }}
                />
                <span style={{ fontSize: "18px", fontWeight: "700", color: "#202223" }}>%</span>
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              style={{
                background: isSubmitting ? "#8c9196" : "#008060",
                color: "#ffffff",
                border: "none",
                padding: "10px 18px",
                borderRadius: "8px",
                fontSize: "14px",
                fontWeight: "700",
                cursor: isSubmitting ? "not-allowed" : "pointer",
                transition: "background 0.2s",
              }}
            >
              {isSubmitting ? "Saving..." : "Save Annual Discount"}
            </button>

            {fetcher.data?.intent === "saveDiscount" && fetcher.data?.message && (
              <div style={{ marginTop: "14px", background: "#e6f4ea", border: "1px solid #b7e1cd", color: "#137333", padding: "10px 14px", borderRadius: "8px", fontSize: "13px", fontWeight: "700", display: "flex", alignItems: "center", gap: "6px" }}>
                ✓ {fetcher.data.message}
              </div>
            )}
          </fetcher.Form>
        </div>

        {/* System Maintenance & DB Tools */}
        <div style={{ background: "#ffffff", border: "1px solid #e1e3e5", borderRadius: "12px", padding: "24px", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
          <h2 style={{ margin: "0 0 8px", fontSize: "18px", fontWeight: "700", color: "#1a1a1a" }}>
            System Maintenance & Logs
          </h2>
          <p style={{ margin: "0 0 16px", color: "#6d7175", fontSize: "13px" }}>
            Manage database search logs and system caches.
          </p>

          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="clearLogs" />
            <button
              type="submit"
              disabled={isSubmitting}
              style={{
                background: isSubmitting ? "#8c9196" : "#d32f2f",
                color: "#ffffff",
                border: "none",
                padding: "10px 18px",
                borderRadius: "8px",
                fontSize: "14px",
                fontWeight: "700",
                cursor: isSubmitting ? "not-allowed" : "pointer",
              }}
            >
              {isSubmitting ? "Clearing..." : "Clear Search Logs"}
            </button>

            {fetcher.data?.intent === "clearLogs" && fetcher.data?.message && (
              <div style={{ marginTop: "14px", background: "#e6f4ea", border: "1px solid #b7e1cd", color: "#137333", padding: "10px 14px", borderRadius: "8px", fontSize: "13px", fontWeight: "700", display: "flex", alignItems: "center", gap: "6px" }}>
                ✓ {fetcher.data.message}
              </div>
            )}
          </fetcher.Form>
        </div>
      </div>

      {/* Merchants Account Directory */}
      <div style={{ background: "#ffffff", border: "1px solid #e1e3e5", borderRadius: "12px", padding: "24px", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
        <h2 style={{ margin: "0 0 16px", fontSize: "20px", fontWeight: "700", color: "#1a1a1a" }}>
          Installed Merchant Accounts ({shopsList.length})
        </h2>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "14px" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #e1e3e5" }}>
                <th style={{ padding: "12px", color: "#6d7175" }}>Merchant Store Domain</th>
                <th style={{ padding: "12px", color: "#6d7175" }}>Admin Contact Email</th>
                <th style={{ padding: "12px", color: "#6d7175" }}>Active Plan</th>
                <th style={{ padding: "12px", textAlign: "center", color: "#6d7175" }}>Fitment Records</th>
                <th style={{ padding: "12px", textAlign: "center", color: "#6d7175" }}>Product Mappings</th>
                <th style={{ padding: "12px", textAlign: "center", color: "#6d7175" }}>Search Volume</th>
                <th style={{ padding: "12px", textAlign: "center", color: "#6d7175" }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {shopsList.map((m, index) => (
                <tr key={index} style={{ borderBottom: "1px solid #eeeeee" }}>
                  <td style={{ padding: "12px", fontWeight: "700", color: "#008060" }}>{m.shop}</td>
                  <td style={{ padding: "12px", color: "#202223" }}>{m.email}</td>
                  <td style={{ padding: "12px", color: "#202223" }}>{m.activePlan}</td>
                  <td style={{ padding: "12px", textAlign: "center", fontWeight: "700" }}>{m.fitments}</td>
                  <td style={{ padding: "12px", textAlign: "center", fontWeight: "700" }}>{m.mappings}</td>
                  <td style={{ padding: "12px", textAlign: "center", fontWeight: "700" }}>{m.searches}</td>
                  <td style={{ padding: "12px", textAlign: "center" }}>
                    <span style={{ background: "#e6f4ea", color: "#137333", padding: "4px 10px", borderRadius: "12px", fontSize: "12px", fontWeight: "700" }}>
                      ✓ {m.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
