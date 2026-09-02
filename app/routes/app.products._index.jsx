const json = (data, init) => Response.json(data, init);
import { useState } from "react";
import { useLoaderData, Link, Form, useNavigation, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

const PAGE_SIZE = 25;

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const search = url.searchParams.get("q") || "";
  const page = parseInt(url.searchParams.get("page") || "1", 10);
  const skip = (page - 1) * PAGE_SIZE;

  let mappedProducts = [];
  let totalCount = 0;

  try {
    const where = {
      fitment: { shop },
      ...(search
        ? {
            OR: [
              { productTitle: { contains: search } },
              { shopifyHandle: { contains: search } },
              { fitment: { year: { contains: search } } },
              { fitment: { make: { contains: search } } },
              { fitment: { model: { contains: search } } },
            ],
          }
        : {}),
    };

    const [items, count] = await Promise.all([
      prisma.fitmentProduct?.findMany({
        where,
        skip,
        take: PAGE_SIZE,
        include: {
          fitment: true,
        },
        orderBy: { id: "desc" },
      }) ?? [],
      prisma.fitmentProduct?.count({ where }) ?? 0,
    ]);

    totalCount = count;

    if (items.length > 0) {
      try {
        const productIds = Array.from(new Set(items.map((i) => i.shopifyProductId).filter(Boolean)));
        if (productIds.length > 0) {
          const res = await admin.graphql(
            `query getProductImages($ids: [ID!]!) {
              nodes(ids: $ids) {
                ... on Product {
                  id
                  featuredImage { url altText }
                }
              }
            }`,
            { variables: { ids: productIds } },
          );
          const data = await res.json();
          const imageMap = new Map();
          (data.data?.nodes || []).forEach((node) => {
            if (node?.id && node?.featuredImage?.url) {
              imageMap.set(node.id, node.featuredImage.url);
            }
          });
          mappedProducts = items.map((item) => ({
            ...item,
            imageUrl: imageMap.get(item.shopifyProductId) || null,
          }));
        } else {
          mappedProducts = items;
        }
      } catch (err) {
        console.error("[products loader GraphQL error]", err);
        mappedProducts = items;
      }
    } else {
      mappedProducts = items;
    }
  } catch (err) {
    console.error("[products loader error]", err);
  }

  return json({
    mappedProducts,
    totalCount,
    page,
    search,
    pageSize: PAGE_SIZE,
  });
};

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  let formData;
  try {
    formData = await request.formData();
  } catch (err) {
    return json({ error: "Invalid form submission" }, { status: 400 });
  }

  const intent = formData.get("intent");

  if (intent === "remove_mapping") {
    const mappingIdRaw = formData.get("mappingId");
    const mappingId = parseInt(mappingIdRaw, 10);
    
    if (mappingId) {
      try {
        await prisma.fitmentProduct?.deleteMany({
          where: { id: mappingId, fitment: { shop } },
        });
      } catch (err) {
        console.error("[remove_mapping action error]", err);
        return json({ error: "Failed to remove mapping" }, { status: 500 });
      }
    }
  }

  return json({ ok: true, success: true });
}

export default function ProductsIndex() {
  const { mappedProducts, totalCount, page, search, pageSize } = useLoaderData();
  const navigation = useNavigation();
  const totalPages = Math.ceil(totalCount / pageSize);

  return (
    <div style={{ padding: "28px 24px 60px", maxWidth: "1240px", margin: "0 auto", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif", color: "#0f172a" }}>
      
      {/* Page Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px", flexWrap: "wrap", gap: "16px" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px" }}>
            <h1 style={{ fontSize: "24px", fontWeight: "800", margin: 0, color: "#0f172a", letterSpacing: "-0.5px" }}>
              Product Fitment Directory
            </h1>
            <span style={{ background: "#ecfdf5", border: "1px solid #a7f3d0", color: "#047857", padding: "2px 10px", borderRadius: "12px", fontSize: "12px", fontWeight: "700" }}>
              {totalCount.toLocaleString()} Mapped Link{totalCount === 1 ? "" : "s"}
            </span>
          </div>
          <p style={{ color: "#64748b", margin: 0, fontSize: "14px" }}>
            View and manage all store products linked to specific Year/Make/Model vehicle fitments.
          </p>
        </div>

        {/* Tab Navigation */}
        <div style={{ display: "flex", gap: "6px", background: "#f1f5f9", borderRadius: "10px", padding: "4px" }}>
          <Link to="/app/products" style={tabStyle(true)}>
            Fitment Mapped Products ({totalCount})
          </Link>
          <Link to="/app/products/universal" style={tabStyle(false)}>
            Universal Products
          </Link>
        </div>
      </div>

      {/* Search & Filter Bar */}
      <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "14px", padding: "16px 20px", marginBottom: "24px", boxShadow: "0 2px 8px rgba(0,0,0,0.02)" }}>
        <Form method="get" style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: "260px" }}>
            <input
              type="text"
              name="q"
              defaultValue={search}
              placeholder="Search by Product Name, SKU/Handle, or Vehicle (e.g. Brake Pad, Ford, 2025)..."
              style={searchInputStyle}
            />
          </div>
          <button type="submit" style={primaryBtn}>
            Search Products
          </button>
          {search && (
            <Link to="/app/products" style={outlineBtn}>
              ✕ Clear Search
            </Link>
          )}
        </Form>
      </div>

      {/* Product Mappings Table Card */}
      <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "16px", overflow: "hidden", boxShadow: "0 4px 16px rgba(0, 0, 0, 0.03)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead style={{ background: "#f8fafc", borderBottom: "2px solid #e2e8f0" }}>
            <tr>
              <th style={thStyle}>Product Details</th>
              <th style={thStyle}>Compatible Vehicle (Year Make Model)</th>
              <th style={{ ...thStyle, textAlign: "center" }}>Mapping Status</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {mappedProducts.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ padding: "48px 24px", textAlign: "center", color: "#64748b" }}>
                  <div style={{ maxWidth: "420px", margin: "0 auto" }}>
                    <div style={{ marginBottom: "12px", color: "#94a3b8" }}>
                      <BoxIcon size={36} color="#94a3b8" />
                    </div>
                    <strong style={{ display: "block", color: "#0f172a", fontSize: "16px", marginBottom: "6px" }}>
                      {search ? `No product mappings matched "${search}"` : "No Product Mappings Found"}
                    </strong>
                    <p style={{ fontSize: "14px", color: "#64748b", margin: "0 0 16px", lineHeight: "1.5" }}>
                      Map store products to vehicle fitments so customers can find compatible parts on your storefront.
                    </p>
                    <Link to="/app/fitment" style={primaryBtn}>
                      Go to Fitment Catalog to Map Products →
                    </Link>
                  </div>
                </td>
              </tr>
            ) : (
              mappedProducts.map((item) => {
                const fitment = item.fitment;
                return (
                  <tr key={item.id} style={{ borderBottom: "1px solid #f1f5f9", transition: "background 0.15s ease" }}>
                    {/* Product Column */}
                    <td style={tdStyle}>
                      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                        {item.imageUrl ? (
                          <img
                            src={item.imageUrl}
                            alt={item.productTitle}
                            style={{ width: "36px", height: "36px", borderRadius: "8px", objectFit: "cover", border: "1px solid #cbd5e1", flexShrink: 0 }}
                          />
                        ) : (
                          <div style={{ width: "36px", height: "36px", borderRadius: "8px", background: "#f1f5f9", border: "1px solid #cbd5e1", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                            <BoxIcon size={18} color="#64748b" />
                          </div>
                        )}
                        <div>
                          <strong style={{ display: "block", color: "#0f172a", fontSize: "14px", fontWeight: "700" }}>
                            {item.productTitle || item.shopifyHandle || `Product #${item.id}`}
                          </strong>
                          {item.shopifyHandle && (
                            <span style={{ color: "#64748b", fontSize: "12px", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", display: "inline-block", marginTop: "2px" }}>
                              /products/{item.shopifyHandle}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Vehicle Column */}
                    <td style={tdStyle}>
                      {fitment ? (
                        <div style={{ display: "inline-block", background: "#f8fafc", border: "1px solid #e2e8f0", padding: "6px 12px", borderRadius: "8px" }}>
                          <div style={{ fontSize: "13px", fontWeight: "700", color: "#0f172a", lineHeight: "1.2", textTransform: "capitalize" }}>
                            <span style={{ color: "#2563eb", fontWeight: "800", marginRight: "4px" }}>{fitment.year}</span>
                            {fitment.make} {fitment.model}
                          </div>
                          {fitment.trim && (
                            <div style={{ fontSize: "11px", color: "#64748b", fontWeight: "600", marginTop: "2px" }}>
                              Trim: {fitment.trim}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span style={{ color: "#94a3b8", fontSize: "13px", fontStyle: "italic" }}>Fitment record removed</span>
                      )}
                    </td>

                    {/* Status Column */}
                    <td style={{ ...tdStyle, textAlign: "center" }}>
                      <span
                        style={{
                          background: "#ecfdf5",
                          border: "1px solid #a7f3d0",
                          color: "#047857",
                          padding: "3px 10px",
                          borderRadius: "12px",
                          fontSize: "12px",
                          fontWeight: "700",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "4px",
                        }}
                      >
                        ✓ Active Mapped
                      </span>
                    </td>

                    {/* Actions Column */}
                    <td style={{ ...tdStyle, textAlign: "right" }}>
                      <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", alignItems: "center" }}>
                        {fitment && (
                          <Link
                            to={`/app/fitment/${fitment.id}/products`}
                            style={tableActionBtn("#2563eb", "#eff6ff")}
                            title="Manage products for this vehicle"
                          >
                            Manage Mappings →
                          </Link>
                        )}
                        <UnlinkButton mappingId={item.id} />
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Bar */}
      {totalPages > 1 && (
        <div style={{ display: "flex", gap: "8px", marginTop: "24px", justifyContent: "center", alignItems: "center" }}>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <Link
              key={p}
              to={`/app/products?page=${p}${search ? `&q=${encodeURIComponent(search)}` : ""}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: "36px",
                height: "36px",
                borderRadius: "8px",
                textDecoration: "none",
                fontSize: "14px",
                fontWeight: "700",
                background: p === page ? "#008060" : "#ffffff",
                color: p === page ? "#ffffff" : "#475569",
                border: `1px solid ${p === page ? "#008060" : "#cbd5e1"}`,
                boxShadow: p === page ? "0 2px 6px rgba(0, 128, 96, 0.3)" : "none",
              }}
            >
              {p}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// Unlink Button Component with Inline Confirmation (avoiding Shopify Iframe confirm() blocks)
function UnlinkButton({ mappingId }) {
  const fetcher = useFetcher();
  const isDeleting = fetcher.state !== "idle";
  const [confirming, setConfirming] = useState(false);

  if (isDeleting) {
    return (
      <span style={{ fontSize: "12px", color: "#94a3b8", fontStyle: "italic", padding: "6px 8px" }}>
        Unlinking...
      </span>
    );
  }

  if (confirming) {
    return (
      <div style={{ display: "inline-flex", gap: "4px", alignItems: "center" }}>
        <button
          type="button"
          onClick={() => {
            fetcher.submit(
              { intent: "remove_mapping", mappingId: mappingId.toString() },
              { method: "post" }
            );
          }}
          style={tableActionBtn("#ffffff", "#dc2626")}
        >
          Confirm
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          style={tableActionBtn("#475569", "#f1f5f9")}
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      style={tableActionBtn("#dc2626", "#fef2f2")}
      title="Remove this product fitment link"
    >
      Unlink
    </button>
  );
}

// Styling Tokens
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
  padding: "11px 16px",
  border: "1px solid #cbd5e1",
  borderRadius: "8px",
  fontSize: "14px",
  outline: "none",
  boxSizing: "border-box",
};

const thStyle = {
  padding: "14px 18px",
  textAlign: "left",
  fontSize: "12px",
  color: "#64748b",
  fontWeight: "700",
  textTransform: "uppercase",
  letterSpacing: "0.5px",
};

const tdStyle = {
  padding: "16px 18px",
  fontSize: "14px",
};

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
