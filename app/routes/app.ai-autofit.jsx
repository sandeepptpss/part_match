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
  const [selectedIds, setSelectedIds] = useState(
    () => new Set((data.extracted || []).map((_, idx) => idx)),
  );

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

  const extracted = data.extracted || [];

  const toggleSelect = (idx) => {
    const next = new Set(selectedIds);
    if (next.has(idx)) next.delete(idx);
    else next.add(idx);
    setSelectedIds(next);
  };

  const handleApply = () => {
    const payload = extracted.filter((_, idx) => selectedIds.has(idx));
    fetcher.submit(
      { selectedItems: JSON.stringify(payload) },
      { method: "post" },
    );
  };

  return (
    <div style={{ padding: "32px 24px", maxWidth: "900px", margin: "0 auto", fontFamily: "sans-serif", color: "#1e293b" }}>
      <Link to="/app/fitment" style={{ color: "#2563eb", fontWeight: "600", textDecoration: "none", display: "inline-block", marginBottom: "16px" }}>
        ← Back to Fitments
      </Link>

      <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "16px", padding: "28px", boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.05)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #f1f5f9", paddingBottom: "16px", marginBottom: "20px" }}>
          <div>
            <h1 style={{ fontSize: "22px", fontWeight: "800", margin: 0 }}>1-Click AI Catalog Auto-Fitter</h1>
            <p style={{ color: "#64748b", margin: "4px 0 0", fontSize: "14px" }}>
              Scanned {data.productsCount} store products and automatically detected vehicle compatibility.
            </p>
          </div>
          <button
            onClick={handleApply}
            disabled={saving || selectedIds.size === 0}
            style={{
              background: selectedIds.size > 0 ? "#2563eb" : "#cbd5e1",
              color: "#ffffff",
              border: "none",
              padding: "10px 20px",
              borderRadius: "8px",
              fontWeight: "700",
              cursor: selectedIds.size > 0 ? "pointer" : "not-allowed",
            }}
          >
            {saving ? "Saving Fitments…" : `Accept & Save ${selectedIds.size} Fitments →`}
          </button>
        </div>

        {fetcher.data?.success && (
          <div style={{ background: "#ecfdf5", border: "1px solid #a7f3d0", color: "#047857", padding: "14px", borderRadius: "8px", marginBottom: "20px", fontWeight: "600" }}>
            ✓ Successfully mapped {fetcher.data.count} fitments into your catalog!
          </div>
        )}

        {extracted.length === 0 ? (
          <p style={{ color: "#64748b" }}>No vehicle compatibility could be automatically inferred from current product titles.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {extracted.map((item, idx) => {
              const isChecked = selectedIds.has(idx);
              return (
                <div
                  key={idx}
                  onClick={() => toggleSelect(idx)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "14px",
                    padding: "14px 18px",
                    background: isChecked ? "#f0f9ff" : "#ffffff",
                    border: isChecked ? "1px solid #0284c7" : "1px solid #e2e8f0",
                    borderRadius: "10px",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => {}}
                    style={{ transform: "scale(1.2)" }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: "700", fontSize: "15px", color: "#0f172a" }}>
                      {item.year} {item.make} {item.model} {item.trim}
                    </div>
                    <div style={{ fontSize: "13px", color: "#64748b", marginTop: "2px" }}>
                      Product: <strong>{item.productTitle}</strong> ({item.reason})
                    </div>
                  </div>
                  <div style={{ background: "#dbeafe", color: "#1e40af", padding: "4px 10px", borderRadius: "20px", fontSize: "12px", fontWeight: "700" }}>
                    {item.confidence}% Match
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
