import { useState } from "react";
import { useLoaderData, useFetcher, Link } from "react-router";
const json = (data, init) => Response.json(data, init);
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { extractFitmentFromProductCatalog } from "../ai.server";
import { getShopPlan, planLimits } from "../plans.server";

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  const { plan } = await getShopPlan(shop);
  const limits = planLimits(plan);

  if (!limits.aiFitmentSuggestions) {
    return json({
      allowed: false,
      message: "AI Auto-Fit is an Enterprise plan feature. Upgrade your plan to automatically map catalog fitments.",
    });
  }

  // Fetch up to 25 products from Shopify catalog
  let products = [];
  try {
    const res = await admin.graphql(
      `query getCatalog {
        products(first: 25) {
          nodes {
            id
            handle
            title
            description
          }
        }
      }`,
    );
    const data = await res.json();
    products = data.data?.products?.nodes || [];
  } catch (err) {
    console.error("[app.ai-autofit] Failed to fetch catalog:", err);
  }

  const { extracted, mock } = await extractFitmentFromProductCatalog(products);

  return json({
    allowed: true,
    productsCount: products.length,
    extracted,
    mock,
  });
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const selectedItemsRaw = formData.get("selectedItems")?.toString() || "[]";

  let selectedItems = [];
  try {
    selectedItems = JSON.parse(selectedItemsRaw);
  } catch {
    return json({ error: "Invalid selection payload" }, { status: 400 });
  }

  let createdCount = 0;
  for (const item of selectedItems) {
    const { year, make, model, trim = "", shopifyProductId, shopifyHandle, productTitle } = item;
    if (!year || !make || !model || !shopifyProductId) continue;

    try {
      const fitment = await prisma.fitmentRecord.upsert({
        where: { shop_year_make_model_trim: { shop, year, make, model, trim } },
        create: { shop, year, make, model, trim },
        update: {},
      });

      await prisma.fitmentProduct.upsert({
        where: {
          fitmentId_shopifyProductId: {
            fitmentId: fitment.id,
            shopifyProductId,
          },
        },
        create: {
          fitmentId: fitment.id,
          shopifyProductId,
          shopifyHandle: shopifyHandle || "",
          productTitle: productTitle || "",
        },
        update: {
          shopifyHandle: shopifyHandle || "",
          productTitle: productTitle || "",
        },
      });

      createdCount++;
    } catch (err) {
      console.error("[app.ai-autofit] Failed to save fitment item:", item, err);
    }
  }

  return json({ success: true, count: createdCount });
};

export default function AiAutoFitCatalog() {
  const data = useLoaderData();
  const fetcher = useFetcher();
  const extracted = data.extracted || [];

  // Filter items by confidence threshold by default (auto-select high confidence >= 80%)
  const [selectedIds, setSelectedIds] = useState(
    () => new Set(extracted.map((item, idx) => (item.confidence >= 80 ? idx : null)).filter((val) => val !== null)),
  );
  const [activeTab, setActiveTab] = useState("all"); // "all" | "high" | "medium" | "low"

  const saving = fetcher.state !== "idle";

  if (!data.allowed) {
    return (
      <div style={{ padding: "32px", maxWidth: "800px", margin: "0 auto", fontFamily: "sans-serif" }}>
        <div style={{ background: "#fffbe6", border: "1px solid #ffe58f", padding: "24px", borderRadius: "12px" }}>
          <h2 style={{ color: "#b45309", marginTop: 0 }}>Enterprise AI Feature</h2>
          <p>{data.message}</p>
          <Link to="/app/plans" style={{ color: "#2563eb", fontWeight: "700" }}>Upgrade to Enterprise →</Link>
        </div>
      </div>
    );
  }

  const highConfidenceCount = extracted.filter((i) => i.confidence >= 90).length;
  const mediumConfidenceCount = extracted.filter((i) => i.confidence >= 75 && i.confidence < 90).length;
  const lowConfidenceCount = extracted.filter((i) => i.confidence < 75).length;

  const filteredExtracted = extracted.filter((item) => {
    if (activeTab === "high") return item.confidence >= 90;
    if (activeTab === "medium") return item.confidence >= 75 && item.confidence < 90;
    if (activeTab === "low") return item.confidence < 75;
    return true;
  });

  const toggleSelect = (idx) => {
    const next = new Set(selectedIds);
    if (next.has(idx)) next.delete(idx);
    else next.add(idx);
    setSelectedIds(next);
  };

  const selectHighOnly = () => {
    const highIndices = extracted
      .map((item, idx) => (item.confidence >= 90 ? idx : null))
      .filter((val) => val !== null);
    setSelectedIds(new Set(highIndices));
  };

  const selectAll = () => {
    setSelectedIds(new Set(extracted.map((_, idx) => idx)));
  };

  const deselectAll = () => {
    setSelectedIds(new Set());
  };

  const handleApply = () => {
    const payload = extracted.filter((_, idx) => selectedIds.has(idx));
    fetcher.submit(
      { selectedItems: JSON.stringify(payload) },
      { method: "post" },
    );
  };

  const getConfidenceBadge = (confidence) => {
    if (confidence >= 90) {
      return (
        <div style={{ background: "#ecfdf5", border: "1px solid #a7f3d0", color: "#047857", padding: "5px 12px", borderRadius: "20px", fontSize: "12px", fontWeight: "800", display: "inline-flex", alignItems: "center", gap: "6px" }}>
          <span>✓</span> {confidence}% High Match
        </div>
      );
    }
    if (confidence >= 75) {
      return (
        <div style={{ background: "#fffbeb", border: "1px solid #fde68a", color: "#b45309", padding: "5px 12px", borderRadius: "20px", fontSize: "12px", fontWeight: "800", display: "inline-flex", alignItems: "center", gap: "6px" }}>
          <span>⚠️</span> {confidence}% Review Specs
        </div>
      );
    }
    return (
      <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", padding: "5px 12px", borderRadius: "20px", fontSize: "12px", fontWeight: "800", display: "inline-flex", alignItems: "center", gap: "6px" }}>
        <span>❓</span> {confidence}% Low Match
      </div>
    );
  };

  return (
    <div style={{ padding: "32px 24px 60px", maxWidth: "1050px", margin: "0 auto", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", color: "#0f172a" }}>
      <Link to="/app/fitment" style={{ color: "#2563eb", fontWeight: "600", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "6px", marginBottom: "20px" }}>
        ← Back to Fitments Management
      </Link>

      {/* Header Banner */}
      <div style={{ background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)", borderRadius: "18px", padding: "30px", color: "#ffffff", marginBottom: "24px", boxShadow: "0 10px 25px -5px rgba(15, 23, 42, 0.25)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
              <h1 style={{ fontSize: "24px", fontWeight: "800", margin: 0, letterSpacing: "-0.5px" }}>
                1-Click AI Catalog Auto-Fitter
              </h1>
              <span style={{ background: "#059669", color: "#ffffff", padding: "3px 10px", borderRadius: "12px", fontSize: "11px", fontWeight: "800", textTransform: "uppercase" }}>
                Merchant Review Queue Active
              </span>
            </div>
            <p style={{ color: "#94a3b8", margin: 0, fontSize: "14px" }}>
              Scanned {data.productsCount} store products and scored fitments by AI confidence accuracy to prevent wrong vehicle mappings.
            </p>
          </div>

          <button
            onClick={handleApply}
            disabled={saving || selectedIds.size === 0}
            style={{
              background: selectedIds.size > 0 ? "linear-gradient(135deg, #008060 0%, #005e46 100%)" : "#475569",
              color: "#ffffff",
              border: "none",
              padding: "12px 24px",
              borderRadius: "10px",
              fontWeight: "800",
              fontSize: "14px",
              cursor: selectedIds.size > 0 ? "pointer" : "not-allowed",
              boxShadow: selectedIds.size > 0 ? "0 4px 14px rgba(0, 128, 96, 0.3)" : "none",
              transition: "all 0.2s ease",
            }}
          >
            {saving ? "Saving Fitments…" : `Accept & Save ${selectedIds.size} Fitments →`}
          </button>
        </div>
      </div>

      {/* Review Queue Summary Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px", marginBottom: "24px" }}>
        <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "14px", padding: "18px", boxShadow: "0 2px 8px rgba(0,0,0,0.02)" }}>
          <div style={{ fontSize: "12px", color: "#64748b", fontWeight: "700", textTransform: "uppercase", marginBottom: "4px" }}>Total Suggestions</div>
          <div style={{ fontSize: "24px", fontWeight: "800", color: "#0f172a" }}>{extracted.length}</div>
        </div>

        <div style={{ background: "#ffffff", border: "1px solid #a7f3d0", borderRadius: "14px", padding: "18px", boxShadow: "0 2px 8px rgba(4, 120, 87, 0.04)" }}>
          <div style={{ fontSize: "12px", color: "#047857", fontWeight: "700", textTransform: "uppercase", marginBottom: "4px" }}>High Confidence (90%+)</div>
          <div style={{ fontSize: "24px", fontWeight: "800", color: "#047857" }}>{highConfidenceCount}</div>
        </div>

        <div style={{ background: "#ffffff", border: "1px solid #fde68a", borderRadius: "14px", padding: "18px", boxShadow: "0 2px 8px rgba(180, 83, 9, 0.04)" }}>
          <div style={{ fontSize: "12px", color: "#b45309", fontWeight: "700", textTransform: "uppercase", marginBottom: "4px" }}>Medium Confidence (75-89%)</div>
          <div style={{ fontSize: "24px", fontWeight: "800", color: "#b45309" }}>{mediumConfidenceCount}</div>
        </div>

        <div style={{ background: "#ffffff", border: "1px solid #fecaca", borderRadius: "14px", padding: "18px", boxShadow: "0 2px 8px rgba(153, 27, 27, 0.04)" }}>
          <div style={{ fontSize: "12px", color: "#991b1b", fontWeight: "700", textTransform: "uppercase", marginBottom: "4px" }}>Low Confidence (&lt;75%)</div>
          <div style={{ fontSize: "24px", fontWeight: "800", color: "#991b1b" }}>{lowConfidenceCount}</div>
        </div>
      </div>

      {/* Main Review Queue Card */}
      <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "18px", padding: "24px", boxShadow: "0 4px 16px rgba(0, 0, 0, 0.03)" }}>
        
        {/* Toolbar & Filters */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "14px", borderBottom: "1px solid #f1f5f9", paddingBottom: "16px", marginBottom: "20px" }}>
          
          {/* Tab Filters */}
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {[
              { id: "all", label: `All (${extracted.length})` },
              { id: "high", label: `High Match (${highConfidenceCount})` },
              { id: "medium", label: `Needs Review (${mediumConfidenceCount})` },
              { id: "low", label: `Low Match (${lowConfidenceCount})` },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                style={{
                  background: activeTab === tab.id ? "#0f172a" : "#f1f5f9",
                  color: activeTab === tab.id ? "#ffffff" : "#475569",
                  border: "none",
                  padding: "8px 14px",
                  borderRadius: "8px",
                  fontSize: "13px",
                  fontWeight: "700",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Quick Selection Actions */}
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={selectHighOnly}
              style={{ background: "#ecfdf5", border: "1px solid #a7f3d0", color: "#047857", padding: "6px 12px", borderRadius: "8px", fontSize: "12px", fontWeight: "700", cursor: "pointer" }}
            >
              ✓ Select High Confidence Only
            </button>
            <button
              type="button"
              onClick={selectAll}
              style={{ background: "#f8fafc", border: "1px solid #cbd5e1", color: "#334155", padding: "6px 12px", borderRadius: "8px", fontSize: "12px", fontWeight: "700", cursor: "pointer" }}
            >
              Select All
            </button>
            <button
              type="button"
              onClick={deselectAll}
              style={{ background: "#f8fafc", border: "1px solid #cbd5e1", color: "#64748b", padding: "6px 12px", borderRadius: "8px", fontSize: "12px", fontWeight: "700", cursor: "pointer" }}
            >
              Deselect All
            </button>
          </div>
        </div>

        {/* Success Alert */}
        {fetcher.data?.success && (
          <div style={{ background: "#ecfdf5", border: "1px solid #a7f3d0", color: "#047857", padding: "16px", borderRadius: "12px", marginBottom: "20px", fontWeight: "700", fontSize: "14px", display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "18px" }}>✓</span>
            <div>Successfully saved {fetcher.data.count} AI-reviewed fitment records to your catalog!</div>
          </div>
        )}

        {/* Suggestions List */}
        {filteredExtracted.length === 0 ? (
          <div style={{ padding: "40px 20px", textAlign: "center", color: "#64748b" }}>
            <p style={{ margin: 0, fontSize: "15px", fontWeight: "600" }}>No AI suggestions match the selected review filter.</p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {filteredExtracted.map((item) => {
              const realIdx = extracted.indexOf(item);
              const isChecked = selectedIds.has(realIdx);
              return (
                <div
                  key={realIdx}
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleSelect(realIdx)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggleSelect(realIdx);
                    }
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "16px",
                    padding: "16px 20px",
                    background: isChecked ? "#f0f9ff" : "#ffffff",
                    border: isChecked ? "2px solid #0284c7" : "1px solid #e2e8f0",
                    borderRadius: "12px",
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                    boxShadow: isChecked ? "0 4px 12px rgba(2, 132, 199, 0.08)" : "none",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => {}}
                    style={{ transform: "scale(1.3)", accentColor: "#0284c7", cursor: "pointer" }}
                  />

                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px" }}>
                      <strong style={{ fontSize: "16px", color: "#0f172a", fontWeight: "800" }}>
                        {item.year} {item.make} {item.model} {item.trim ? `(${item.trim})` : ""}
                      </strong>
                    </div>
                    <div style={{ fontSize: "13px", color: "#64748b" }}>
                      Target Product: <strong style={{ color: "#1e293b" }}>{item.productTitle}</strong> — <span style={{ italic: true }}>"{item.reason}"</span>
                    </div>
                  </div>

                  <div>
                    {getConfidenceBadge(item.confidence)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

