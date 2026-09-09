import { useState, useMemo } from "react";
import { Link, useLoaderData, Form, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getShopPlan, planLimits } from "../plans.server";

const json = (data, init) => Response.json(data, init);

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  const { plan } = await getShopPlan(shop);
  const limits = planLimits(plan);

  let universalProducts = [];
  try {
    universalProducts = (await prisma.universalProduct?.findMany({
      where: { shop },
      orderBy: { productTitle: "asc" },
    })) || [];
  } catch (err) {
    console.error("[universalProducts loader error]", err);
  }

  let shopifyProducts = [];
  try {
    const res = await admin.graphql(`
      query {
        products(first: 50) {
          nodes { id title handle status }
        }
      }
    `);
    const data = await res.json();
    shopifyProducts = data.data?.products?.nodes ?? [];
  } catch (err) {
    console.error("[universalProducts graphql error]", err);
  }

  const assignedIds = new Set(universalProducts.map((p) => p.shopifyProductId));
  const available = shopifyProducts.filter((p) => !assignedIds.has(p.id));

  return json({
    universalProducts,
    available,
    planAllowsUniversal: limits.universalProducts,
    planLabel: limits.label,
  });
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  try {
    if (intent === "add") {
      const { plan } = await getShopPlan(shop);
      if (!planLimits(plan).universalProducts) {
        return json({ ok: false, error: "Universal Products requires a paid plan (Starter Pro or above)." }, { status: 403 });
      }
      const shopifyProductId = formData.get("shopifyProductId")?.toString();
      const shopifyHandle = formData.get("shopifyHandle")?.toString() || "";
      const productTitle = formData.get("productTitle")?.toString() || "";
      await prisma.universalProduct?.upsert({
        where: { shop_shopifyProductId: { shop, shopifyProductId } },
        create: { shop, shopifyProductId, shopifyHandle, productTitle },
        update: { shopifyHandle, productTitle },
      });
    }

    if (intent === "remove") {
      const id = parseInt(formData.get("id"), 10);
      await prisma.universalProduct?.deleteMany({ where: { id, shop } });
    }
  } catch (err) {
    console.error("[universalProducts action error]", err);
  }

  return json({ ok: true });
};

export default function UniversalProducts() {
  const { universalProducts, available, planAllowsUniversal, planLabel } = useLoaderData();
  const navigation = useNavigation();
  const saving = navigation.state !== "idle";

  const [searchUniversal, setSearchUniversal] = useState("");
  const [searchAvailable, setSearchAvailable] = useState("");

  const filteredUniversal = useMemo(() => {
    if (!searchUniversal.trim()) return universalProducts;
    const q = searchUniversal.toLowerCase().trim();
    return universalProducts.filter(
      (p) =>
        (p.productTitle || "").toLowerCase().includes(q) ||
        (p.shopifyHandle || "").toLowerCase().includes(q)
    );
  }, [universalProducts, searchUniversal]);

  const filteredAvailable = useMemo(() => {
    if (!searchAvailable.trim()) return available;
    const q = searchAvailable.toLowerCase().trim();
    return available.filter(
      (p) =>
        (p.title || "").toLowerCase().includes(q) ||
        (p.handle || "").toLowerCase().includes(q)
    );
  }, [available, searchAvailable]);

  return (
    <div style={{ padding: "28px 24px 60px", width: "100%", maxWidth: "100%", boxSizing: "border-box", margin: "0 auto", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif", color: "#0f172a" }}>
      {/* Page Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px", flexWrap: "wrap", gap: "16px" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px" }}>
            <h1 style={{ fontSize: "24px", fontWeight: "800", margin: 0, color: "#0f172a", letterSpacing: "-0.5px" }}>
              Universal Products Directory
            </h1>
            <span style={{ background: "#f1f5f9", color: "#475569", padding: "2px 10px", borderRadius: "12px", fontSize: "12px", fontWeight: "700" }}>
              {universalProducts.length.toLocaleString()} Records
            </span>
          </div>
          <p style={{ color: "#64748b", margin: 0, fontSize: "14px" }}>
            Universal products automatically appear in <strong>all</strong> storefront search results regardless of vehicle selection.
          </p>
        </div>

        {/* Action Buttons matching Catalog */}
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
          <Link to="/app/fitment/add" style={primaryBtn}>
            + Add Fitment Record
          </Link>
          <Link to="/app/fitment" style={secondaryBtn}>
            Fitment Catalog
          </Link>
          <Link to="/app/fitment/import" style={outlineBtn}>
            Import CSV
          </Link>
        </div>
      </div>

      {/* Tab Navigation */}
      <div style={{ display: "inline-flex", gap: "6px", background: "#f1f5f9", borderRadius: "10px", padding: "4px", marginBottom: "20px" }}>
        <Link to="/app/products" style={tabStyle(false)}>
          Fitment Mapped Products
        </Link>
        <Link to="/app/products/universal" style={tabStyle(true)}>
          Universal Products ({universalProducts.length})
        </Link>
      </div>

      {/* Plan Feature Banner if not allowed */}
      {!planAllowsUniversal && (
        <div
          style={{
            background: "#fffbeb",
            border: "1px solid #fde68a",
            borderRadius: "14px",
            padding: "16px 20px",
            marginBottom: "24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "16px",
            flexWrap: "wrap",
          }}
        >
          <div>
            <strong style={{ display: "block", color: "#92400e", fontSize: "15px", marginBottom: "2px" }}>
              Universal Products requires Starter Pro or above
            </strong>
            <span style={{ color: "#b45309", fontSize: "13px" }}>
              Your current plan ({planLabel}) does not include adding universal catalog products. Upgrade to unlock this feature.
            </span>
          </div>
          <Link to="/app/plans" style={primaryBtn}>
            View Plans & Upgrade →
          </Link>
        </div>
      )}

      {/* Grid Layout matching modern design system */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px", alignItems: "start" }}>
        {/* Left Column: Current Universal Products */}
        <div style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", paddingBottom: "12px", borderBottom: "1px solid #f1f5f9" }}>
            <div>
              <h2 style={{ fontSize: "16px", fontWeight: "700", color: "#0f172a", margin: "0 0 2px" }}>
                Active Universal Products
              </h2>
              <span style={{ fontSize: "12px", color: "#64748b" }}>
                Always visible to all storefront shoppers
              </span>
            </div>
            <span style={{ background: "#ecfdf5", border: "1px solid #a7f3d0", color: "#047857", padding: "2px 8px", borderRadius: "10px", fontSize: "11px", fontWeight: "700" }}>
              {filteredUniversal.length} Active
            </span>
          </div>

          {/* Quick Search */}
          <div style={{ marginBottom: "14px", position: "relative" }}>
            <input
              type="text"
              value={searchUniversal}
              onChange={(e) => setSearchUniversal(e.target.value)}
              placeholder="Filter active universal items…"
              style={searchInputStyle}
            />
          </div>

          {filteredUniversal.length === 0 ? (
            <div style={{ padding: "40px 16px", textAlign: "center", color: "#64748b" }}>
              <div style={{ marginBottom: "8px", color: "#94a3b8" }}>
                <BoxIcon size={32} color="#94a3b8" />
              </div>
              <strong style={{ display: "block", color: "#0f172a", fontSize: "14px", marginBottom: "4px" }}>
                {searchUniversal ? "No matching universal products" : "No Universal Products Yet"}
              </strong>
              <p style={{ fontSize: "13px", color: "#64748b", margin: 0, lineHeight: "1.4" }}>
                {searchUniversal ? "Try clearing your search query." : "Mark items like car wash soap, phone mounts, or oils that match every vehicle."}
              </p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {filteredUniversal.map((p) => (
                <div key={p.id} style={itemRowStyle}>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px", flex: 1, minWidth: 0 }}>
                    <div style={{ width: "36px", height: "36px", borderRadius: "8px", background: "#f8fafc", border: "1px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <BoxIcon size={18} color="#64748b" />
                    </div>
                    <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      <div style={{ fontWeight: "700", fontSize: "14px", color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {p.productTitle || p.shopifyHandle}
                      </div>
                      {p.shopifyHandle && (
                        <div style={{ color: "#64748b", fontSize: "12px", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", marginTop: "1px" }}>
                          /products/{p.shopifyHandle}
                        </div>
                      )}
                    </div>
                  </div>
                  <Form method="post" style={{ flexShrink: 0 }}>
                    <input type="hidden" name="intent" value="remove" />
                    <input type="hidden" name="id" value={p.id} />
                    <button
                      type="submit"
                      disabled={saving}
                      style={tableActionBtn("#dc2626", "#fee2e2")}
                      title="Remove product from universal catalog"
                    >
                      ✕ Remove
                    </button>
                  </Form>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right Column: Add Universal Products */}
        <div style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", paddingBottom: "12px", borderBottom: "1px solid #f1f5f9" }}>
            <div>
              <h2 style={{ fontSize: "16px", fontWeight: "700", color: "#0f172a", margin: "0 0 2px" }}>
                Add Universal Product
              </h2>
              <span style={{ fontSize: "12px", color: "#64748b" }}>
                Select from store catalog to mark as universal
              </span>
            </div>
            <span style={{ background: "#eff6ff", border: "1px solid #bfdbfe", color: "#1d4ed8", padding: "2px 8px", borderRadius: "10px", fontSize: "11px", fontWeight: "700" }}>
              {available.length} Available
            </span>
          </div>

          {/* Quick Search */}
          <div style={{ marginBottom: "14px", position: "relative" }}>
            <input
              type="text"
              value={searchAvailable}
              onChange={(e) => setSearchAvailable(e.target.value)}
              placeholder="Search store products by title or handle…"
              style={searchInputStyle}
            />
          </div>

          {available.length === 0 ? (
            <div style={{ padding: "40px 16px", textAlign: "center", color: "#64748b" }}>
              <div style={{ marginBottom: "8px", color: "#94a3b8" }}>
                <BoxIcon size={32} color="#94a3b8" />
              </div>
              <strong style={{ display: "block", color: "#0f172a", fontSize: "14px", marginBottom: "4px" }}>
                All Catalog Products Assigned
              </strong>
              <p style={{ fontSize: "13px", color: "#64748b", margin: 0 }}>
                Every loaded Shopify product is already configured.
              </p>
            </div>
          ) : filteredAvailable.length === 0 ? (
            <div style={{ padding: "30px 16px", textAlign: "center", color: "#64748b" }}>
              <p style={{ fontSize: "13px", margin: 0 }}>No available products match &quot;{searchAvailable}&quot;.</p>
            </div>
          ) : (
            <div style={{ maxHeight: "480px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "8px", paddingRight: "4px" }}>
              {filteredAvailable.map((p) => (
                <div key={p.id} style={itemRowStyle}>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px", flex: 1, minWidth: 0 }}>
                    <div style={{ width: "36px", height: "36px", borderRadius: "8px", background: "#f8fafc", border: "1px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <BoxIcon size={18} color="#64748b" />
                    </div>
                    <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      <div style={{ fontWeight: "700", fontSize: "14px", color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {p.title}
                      </div>
                      {p.handle && (
                        <div style={{ color: "#64748b", fontSize: "12px", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", marginTop: "1px" }}>
                          /products/{p.handle}
                        </div>
                      )}
                    </div>
                  </div>
                  <Form method="post" style={{ flexShrink: 0 }}>
                    <input type="hidden" name="intent" value="add" />
                    <input type="hidden" name="shopifyProductId" value={p.id} />
                    <input type="hidden" name="shopifyHandle" value={p.handle} />
                    <input type="hidden" name="productTitle" value={p.title} />
                    <button
                      type="submit"
                      disabled={saving || !planAllowsUniversal}
                      style={{
                        ...tableActionBtn("#047857", "#ecfdf5"),
                        opacity: !planAllowsUniversal ? 0.5 : 1,
                        cursor: !planAllowsUniversal ? "not-allowed" : "pointer",
                      }}
                      title={!planAllowsUniversal ? "Upgrade plan to add universal products" : "Mark as universal"}
                    >
                      + Mark Universal
                    </button>
                  </Form>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const tabStyle = (active) => ({
  display: "inline-flex",
  alignItems: "center",
  padding: "8px 16px",
  borderRadius: "8px",
  textDecoration: "none",
  fontSize: "13px",
  fontWeight: active ? "700" : "600",
  background: active ? "#ffffff" : "transparent",
  color: active ? "#008060" : "#64748b",
  boxShadow: active ? "0 2px 6px rgba(0,0,0,0.06)" : "none",
  transition: "all 0.15s ease",
});

const cardStyle = {
  background: "#ffffff",
  border: "1px solid #e2e8f0",
  borderRadius: "14px",
  padding: "20px",
  boxShadow: "0 4px 16px rgba(0, 0, 0, 0.03)",
};

const itemRowStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "12px",
  padding: "10px 14px",
  borderRadius: "10px",
  border: "1px solid #f1f5f9",
  background: "#ffffff",
  transition: "all 0.15s ease",
};

const primaryBtn = {
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  background: "#008060",
  color: "#ffffff",
  padding: "10px 18px",
  borderRadius: "8px",
  textDecoration: "none",
  fontSize: "14px",
  fontWeight: "700",
  border: "none",
  cursor: "pointer",
  boxShadow: "0 2px 6px rgba(0, 128, 96, 0.25)",
};

const secondaryBtn = {
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  background: "#2563eb",
  color: "#ffffff",
  padding: "10px 16px",
  borderRadius: "8px",
  textDecoration: "none",
  fontSize: "14px",
  fontWeight: "600",
  border: "none",
  boxShadow: "0 2px 6px rgba(37, 99, 235, 0.25)",
};

const outlineBtn = {
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  background: "#ffffff",
  color: "#475569",
  border: "1px solid #cbd5e1",
  padding: "10px 16px",
  borderRadius: "8px",
  textDecoration: "none",
  fontSize: "14px",
  fontWeight: "600",
};

const searchInputStyle = {
  width: "100%",
  padding: "9px 14px",
  border: "1px solid #cbd5e1",
  borderRadius: "8px",
  fontSize: "13px",
  outline: "none",
  boxSizing: "border-box",
  background: "#f8fafc",
};

const tableActionBtn = (color, bg) => ({
  display: "inline-flex",
  alignItems: "center",
  background: bg,
  color: color,
  border: "none",
  padding: "6px 12px",
  borderRadius: "6px",
  textDecoration: "none",
  fontSize: "13px",
  fontWeight: "700",
  cursor: "pointer",
  transition: "all 0.15s ease",
  whiteSpace: "nowrap",
});

function BoxIcon({ size = 18, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  );
}
