import { useState } from "react";
import { useLoaderData, Form, useNavigation, useActionData, Link } from "react-router";
const json = (data, init) => Response.json(data, init);
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getShopPlan, planLimits } from "../plans.server";
import { suggestFitmentProducts, isAiConfigured } from "../ai.server";

export const loader = async ({ request, params }) => {
  const { session, admin } = await authenticate.admin(request);
  const fitmentId = parseInt(params.id, 10);

  const fitment = await prisma.fitmentRecord?.findFirst({
    where: { id: fitmentId, shop: session.shop },
    include: {
      products: true,
      collections: true,
      tags: true,
    },
  });

  if (!fitment) {
    throw new Response("Fitment record not found", { status: 404 });
  }

  // Fetch products & collections from Shopify for pickers
  let shopifyProducts = [];
  let shopifyCollections = [];

  try {
    const shopifyRes = await admin.graphql(`
      query {
        products(first: 50) {
          nodes {
            id
            title
            handle
            featuredImage { url altText }
            status
          }
        }
        collections(first: 50) {
          nodes {
            id
            title
            handle
          }
        }
      }
    `);
    const shopifyData = await shopifyRes.json();
    shopifyProducts = shopifyData.data?.products?.nodes ?? [];
    shopifyCollections = shopifyData.data?.collections?.nodes ?? [];
  } catch (err) {
    console.error("[app.fitment.$id.products] Loader GraphQL fetch error:", err);
  }

  const shopPlan = await getShopPlan(session.shop);
  const canUseAi = planLimits(shopPlan.plan).aiFitmentSuggestions;

  return json({
    fitment,
    shopifyProducts,
    shopifyCollections,
    canUseAi,
    aiConfigured: isAiConfigured(),
  });
};

export const action = async ({ request, params }) => {
  const { session, admin } = await authenticate.admin(request);
  const fitmentId = parseInt(params.id, 10);
  const formData = await request.formData();
  const intent = formData.get("intent");

  // Verify ownership
  const fitment = await prisma.fitmentRecord?.findFirst({
    where: { id: fitmentId, shop: session.shop },
    include: { products: true, collections: true, tags: true },
  });
  if (!fitment) throw new Response("Not found", { status: 404 });

  if (intent === "aiSuggest") {
    const shopPlan = await getShopPlan(session.shop);
    if (!planLimits(shopPlan.plan).aiFitmentSuggestions) {
      return json(
        { intent: "aiSuggest", error: "AI-Powered Fitment Suggestions is an Enterprise plan feature. Upgrade to unlock it." },
        { status: 403 },
      );
    }

    const assignedIds = new Set(fitment.products.map((p) => p.shopifyProductId));
    const shopifyRes = await admin.graphql(`
      query {
        products(first: 50) {
          nodes { id title description }
        }
      }
    `);
    const shopifyData = await shopifyRes.json();
    const candidates = (shopifyData.data?.products?.nodes ?? []).filter((p) => !assignedIds.has(p.id));

    try {
      const { suggestions, mock } = await suggestFitmentProducts({
        year: fitment.year,
        make: fitment.make,
        model: fitment.model,
        products: candidates,
      });
      return json({ intent: "aiSuggest", suggestions, mock });
    } catch (err) {
      console.error("[app.fitment.$id.products] AI suggest failed:", err);
      return json({ intent: "aiSuggest", error: "AI suggestion request failed. Please try again." }, { status: 502 });
    }
  }

  // Individual Product Mapping Actions
  if (intent === "add") {
    const productId = formData.get("shopifyProductId")?.toString();
    const handle = formData.get("shopifyHandle")?.toString() || "";
    const title = formData.get("productTitle")?.toString() || handle || "Product";

    if (!productId) return json({ error: "No product selected" }, { status: 400 });

    await prisma.fitmentProduct?.upsert({
      where: { fitmentId_shopifyProductId: { fitmentId, shopifyProductId: productId } },
      create: { fitmentId, shopifyProductId: productId, shopifyHandle: handle, productTitle: title },
      update: { shopifyHandle: handle, productTitle: title },
    });

    return json({ ok: true, actionType: "add", message: `Product "${title}" assigned successfully!` });
  }

  if (intent === "remove") {
    const id = parseInt(formData.get("id"), 10);
    const title = formData.get("productTitle")?.toString() || "Product";

    await prisma.fitmentProduct?.deleteMany({ where: { id, fitmentId } });
    return json({ ok: true, actionType: "remove", message: `Product "${title}" removed from fitment.` });
  }

  // Collection-Based Mapping Actions
  if (intent === "addCollection") {
    const collectionId = formData.get("shopifyCollectionId")?.toString() || "";
    const handle = formData.get("shopifyHandle")?.toString() || "";
    const title = formData.get("collectionTitle")?.toString() || handle || "Collection";

    if (!collectionId && !handle) return json({ error: "No collection selected" }, { status: 400 });

    const keyId = collectionId || `custom-${handle}`;

    await prisma.fitmentCollection?.upsert({
      where: { fitmentId_shopifyCollectionId: { fitmentId, shopifyCollectionId: keyId } },
      create: {
        fitmentId,
        shopifyCollectionId: keyId,
        shopifyHandle: handle,
        collectionTitle: title,
      },
      update: {
        shopifyHandle: handle,
        collectionTitle: title,
      },
    });

    return json({ ok: true, actionType: "add", message: `Collection "${title}" added successfully!` });
  }

  if (intent === "removeCollection") {
    const id = parseInt(formData.get("id"), 10);
    const title = formData.get("collectionTitle")?.toString() || "Collection";

    await prisma.fitmentCollection?.deleteMany({ where: { id, fitmentId } });
    return json({ ok: true, actionType: "remove", message: `Collection "${title}" removed from fitment.` });
  }

  // Tag-Based Mapping Actions
  if (intent === "addTag") {
    let tag = formData.get("tag")?.toString() || "";
    tag = tag.trim().replace(/^#/, "");

    if (!tag) return json({ error: "Please enter a tag name" }, { status: 400 });

    await prisma.fitmentTag?.upsert({
      where: { fitmentId_tag: { fitmentId, tag } },
      create: { fitmentId, tag },
      update: {},
    });

    return json({ ok: true, actionType: "add", message: `Tag "#${tag}" added successfully!` });
  }

  if (intent === "removeTag") {
    const id = parseInt(formData.get("id"), 10);
    const tag = formData.get("tag")?.toString() || "";

    await prisma.fitmentTag?.deleteMany({ where: { id, fitmentId } });
    return json({ ok: true, actionType: "remove", message: `Tag "#${tag}" removed from fitment.` });
  }

  return json({ ok: true });
};

export default function FitmentProducts() {
  const { fitment, shopifyProducts, shopifyCollections, canUseAi, aiConfigured } = useLoaderData();
  const navigation = useNavigation();
  const actionData = useActionData();
  const saving = navigation.state !== "idle";
  const aiLoading = navigation.state !== "idle" && navigation.formData?.get("intent") === "aiSuggest";

  const [activeTab, setActiveTab] = useState("products");
  const [customTagInput, setCustomTagInput] = useState("");
  const [customCollectionInput, setCustomCollectionInput] = useState("");

  const assignedProductIds = new Set(fitment.products.map((p) => p.shopifyProductId));
  const availableProducts = shopifyProducts.filter((p) => !assignedProductIds.has(p.id));

  const assignedCollectionIds = new Set(fitment.collections.map((c) => c.shopifyCollectionId));
  const availableCollections = shopifyCollections.filter((c) => !assignedCollectionIds.has(c.id));

  const aiResult = actionData?.intent === "aiSuggest" ? actionData : null;
  const suggestionMap = new Map((aiResult?.suggestions ?? []).map((s) => [s.shopifyProductId, s]));

  const sortedAvailableProducts = [...availableProducts].sort((a, b) => {
    const confA = suggestionMap.get(a.id)?.confidence ?? -1;
    const confB = suggestionMap.get(b.id)?.confidence ?? -1;
    return confB - confA;
  });

  const isRemove = actionData?.actionType === "remove";

  return (
    <div style={{ padding: "28px 24px", maxWidth: "1100px", margin: "0 auto", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif", color: "#202223" }}>
      <Link to="/app/fitment" style={{ color: "#2563eb", fontSize: "14px", fontWeight: "600", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "4px", marginBottom: "16px" }}>
        ← Back to Fitment Catalog
      </Link>

      {/* Vehicle Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", flexWrap: "wrap", gap: "16px" }}>
        <div>
          <h1 style={{ fontSize: "26px", fontWeight: "800", margin: "0 0 6px", color: "#0f172a", letterSpacing: "-0.5px" }}>
            {fitment.year} {fitment.make} {fitment.model}
          </h1>
          <p style={{ color: "#64748b", margin: 0, fontSize: "14px" }}>
            Manage compatible search result rules (Products, Collections, and Tags) for this vehicle fitment.
          </p>
        </div>

        {/* Quick Summary Badges */}
        <div style={{ display: "flex", gap: "8px" }}>
          <span style={badgeStyle("#2563eb", "#eff6ff")}>{fitment.products.length} Products</span>
          <span style={badgeStyle("#7c3aed", "#f3e8ff")}>{fitment.collections.length} Collections</span>
          <span style={badgeStyle("#059669", "#ecfdf5")}>{fitment.tags.length} Tags</span>
        </div>
      </div>

      {/* User Friendly Notification Banner (Green for Add, Soft Red for Remove) */}
      {actionData?.message && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            background: isRemove ? "#fef2f2" : "#ecfdf5",
            border: `1px solid ${isRemove ? "#fecaca" : "#a7f3d0"}`,
            color: isRemove ? "#991b1b" : "#065f46",
            padding: "12px 16px",
            borderRadius: "10px",
            marginBottom: "20px",
            boxShadow: "0 2px 6px rgba(0,0,0,0.03)",
            fontSize: "14px",
            fontWeight: "600",
          }}
        >
          <span style={{ fontSize: "16px", fontWeight: "bold" }}>{isRemove ? "✕" : "✓"}</span>
          <span>{actionData.message}</span>
        </div>
      )}

      {actionData?.error && !actionData?.intent && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            background: "#fef2f2",
            border: "1px solid #fecaca",
            color: "#991b1b",
            padding: "12px 16px",
            borderRadius: "10px",
            marginBottom: "20px",
            fontSize: "14px",
            fontWeight: "600",
          }}
        >
          <span style={{ fontSize: "18px", fontWeight: "bold" }}>⚠️</span>
          <span>{actionData.error}</span>
        </div>
      )}

      {/* Mapping Type Selector Tabs */}
      <div style={{ display: "flex", gap: "10px", marginBottom: "24px", background: "#f8fafc", padding: "6px", borderRadius: "12px", border: "1px solid #e2e8f0", width: "fit-content" }}>
        <button
          type="button"
          onClick={() => setActiveTab("products")}
          style={tabButtonStyle(activeTab === "products")}
        >
          🔄 Products List ({fitment.products.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("collections")}
          style={tabButtonStyle(activeTab === "collections")}
        >
          📁 Collection ({fitment.collections.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("tags")}
          style={tabButtonStyle(activeTab === "tags")}
        >
          # Tags ({fitment.tags.length})
        </button>
      </div>

      {/* ─── TAB 1: PRODUCTS LIST ─────────────────────────────────────────── */}
      {activeTab === "products" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
          {/* Assigned Products */}
          <div style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
              <h3 style={cardHead}>Assigned Products ({fitment.products.length})</h3>
              <span style={{ fontSize: "12px", color: "#64748b", fontWeight: "600" }}>Individual Items</span>
            </div>
            {fitment.products.length === 0 ? (
              <p style={{ color: "#64748b", fontSize: "14px", fontStyle: "italic", padding: "20px 0", textAlign: "center" }}>
                No individual products assigned yet.
              </p>
            ) : (
              <div style={{ maxHeight: "480px", overflowY: "auto" }}>
                {fitment.products.map((p) => {
                  const displayTitle = p.productTitle || p.shopifyHandle || p.shopifyProductId;
                  return (
                    <div key={p.id} style={productRow}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: "600", fontSize: "14px", color: "#1e293b" }}>
                          {displayTitle}
                        </div>
                        <div style={{ color: "#64748b", fontSize: "12px" }}>handle: {p.shopifyHandle}</div>
                      </div>
                      <Form method="post">
                        <input type="hidden" name="intent" value="remove" />
                        <input type="hidden" name="id" value={p.id} />
                        <input type="hidden" name="productTitle" value={displayTitle} />
                        <button type="submit" style={removeBtn} disabled={saving}>✕ Remove</button>
                      </Form>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Available Products Picker */}
          <div style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
              <h3 style={{ ...cardHead, margin: 0 }}>Add Store Products</h3>
              <Form method="post">
                <input type="hidden" name="intent" value="aiSuggest" />
                <button
                  type="submit"
                  disabled={saving || !canUseAi}
                  title={!canUseAi ? "AI Suggestions are available on the Enterprise plan" : ""}
                  style={{ ...aiBtn, opacity: !canUseAi ? 0.5 : 1, cursor: !canUseAi ? "not-allowed" : "pointer" }}
                >
                  {aiLoading ? "Analyzing…" : "✨ AI Suggest Products"}
                </button>
              </Form>
            </div>

            {!canUseAi && (
              <p style={{ fontSize: "12px", color: "#64748b", margin: "0 0 14px" }}>
                AI-Powered Fitment Suggestions is an Enterprise plan feature. <Link to="/app/plans" style={{ color: "#2563eb", fontWeight: "600" }}>Upgrade to unlock</Link>.
              </p>
            )}
            {canUseAi && !aiConfigured && (
              <p style={{ fontSize: "12px", color: "#8a6d00", background: "#fff8e1", padding: "8px 10px", borderRadius: "6px", margin: "0 0 14px" }}>
                Demo Mode: ANTHROPIC_API_KEY is not set on the server, so AI Suggest will show simulated keyword-matched results.
              </p>
            )}
            {aiResult?.error && (
              <p style={{ fontSize: "12px", color: "#c0392b", background: "#fdecea", padding: "8px 10px", borderRadius: "6px", margin: "0 0 14px" }}>
                {aiResult.error}
              </p>
            )}
            {aiResult?.suggestions && !aiResult.error && (
              <p style={{ fontSize: "12px", color: aiResult.mock ? "#8a6d00" : "#137333", background: aiResult.mock ? "#fff8e1" : "#e6f4ea", padding: "8px 10px", borderRadius: "6px", margin: "0 0 14px" }}>
                {aiResult.mock ? "Demo results (keyword match): " : "AI results: "}
                {aiResult.suggestions.length > 0
                  ? `Found ${aiResult.suggestions.length} likely match${aiResult.suggestions.length === 1 ? "" : "es"} for ${fitment.year} ${fitment.make} ${fitment.model}.`
                  : "No likely matches found among store products."}
              </p>
            )}

            {availableProducts.length === 0 ? (
              <p style={{ color: "#64748b", fontSize: "14px", textAlign: "center", padding: "20px 0" }}>All store products are already assigned.</p>
            ) : (
              <div style={{ maxHeight: "420px", overflowY: "auto" }}>
                {sortedAvailableProducts.map((p) => {
                  const suggestion = suggestionMap.get(p.id);
                  return (
                    <div key={p.id} style={productRow}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: "600", fontSize: "14px", color: "#1e293b" }}>{p.title}</div>
                        <div style={{ color: "#64748b", fontSize: "12px" }}>handle: {p.handle}</div>
                        {suggestion && (
                          <div style={{ marginTop: "4px", fontSize: "11px", color: "#8a6d00", background: "#fff8e1", display: "inline-block", padding: "2px 8px", borderRadius: "10px" }}>
                            {suggestion.confidence}% match — {suggestion.reason}
                          </div>
                        )}
                      </div>
                      <Form method="post">
                        <input type="hidden" name="intent" value="add" />
                        <input type="hidden" name="shopifyProductId" value={p.id} />
                        <input type="hidden" name="shopifyHandle" value={p.handle} />
                        <input type="hidden" name="productTitle" value={p.title} />
                        <button type="submit" style={addBtn} disabled={saving}>+ Add</button>
                      </Form>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── TAB 2: COLLECTION-BASED MAPPING ─────────────────────────────── */}
      {activeTab === "collections" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
          {/* Assigned Collections */}
          <div style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
              <h3 style={cardHead}>Assigned Collections ({fitment.collections.length})</h3>
              <span style={{ fontSize: "12px", color: "#7c3aed", fontWeight: "700", background: "#f3e8ff", padding: "2px 8px", borderRadius: "10px" }}>Collection-Based</span>
            </div>
            <p style={{ fontSize: "13px", color: "#64748b", marginTop: 0, marginBottom: "16px" }}>
              All products inside these collections will automatically be matched for <strong>{fitment.year} {fitment.make} {fitment.model}</strong>.
            </p>

            {fitment.collections.length === 0 ? (
              <p style={{ color: "#64748b", fontSize: "14px", fontStyle: "italic", padding: "20px 0", textAlign: "center" }}>
                No collections mapped to this fitment yet.
              </p>
            ) : (
              <div style={{ maxHeight: "420px", overflowY: "auto" }}>
                {fitment.collections.map((c) => {
                  const displayTitle = c.collectionTitle || c.shopifyHandle;
                  return (
                    <div key={c.id} style={productRow}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: "700", fontSize: "14px", color: "#0f172a", display: "flex", alignItems: "center", gap: "6px" }}>
                          📁 {displayTitle}
                        </div>
                        <div style={{ color: "#64748b", fontSize: "12px" }}>handle: {c.shopifyHandle}</div>
                      </div>
                      <Form method="post">
                        <input type="hidden" name="intent" value="removeCollection" />
                        <input type="hidden" name="id" value={c.id} />
                        <input type="hidden" name="collectionTitle" value={displayTitle} />
                        <button type="submit" style={removeBtn} disabled={saving}>✕ Remove</button>
                      </Form>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Add Collection Picker */}
          <div style={card}>
            <h3 style={cardHead}>Add Collection to Fitment</h3>
            <p style={{ fontSize: "13px", color: "#64748b", marginTop: 0, marginBottom: "16px" }}>
              Select a collection from your store or enter a collection handle below.
            </p>

            {/* Custom Collection Handle Form */}
            <Form method="post" style={{ marginBottom: "20px", background: "#f8fafc", padding: "12px", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
              <input type="hidden" name="intent" value="addCollection" />
              <label style={{ display: "block", fontSize: "12px", fontWeight: "700", color: "#334155", marginBottom: "6px" }}>
                Manual Collection Handle / Title
              </label>
              <div style={{ display: "flex", gap: "8px" }}>
                <input
                  name="shopifyHandle"
                  value={customCollectionInput}
                  onChange={(e) => setCustomCollectionInput(e.target.value)}
                  placeholder="e.g. exhaust-systems or brakes"
                  style={{ flex: 1, padding: "8px 12px", border: "1px solid #cbd5e1", borderRadius: "6px", fontSize: "13px" }}
                />
                <button
                  type="submit"
                  style={addBtn}
                  disabled={saving || !customCollectionInput.trim()}
                  onClick={() => setTimeout(() => setCustomCollectionInput(""), 100)}
                >
                  + Add Collection
                </button>
              </div>
            </Form>

            {/* Available Store Collections List */}
            <h4 style={{ fontSize: "13px", fontWeight: "700", color: "#475569", marginBottom: "10px" }}>
              Store Collections ({availableCollections.length})
            </h4>

            {availableCollections.length === 0 ? (
              <p style={{ color: "#64748b", fontSize: "13px", fontStyle: "italic" }}>
                No additional store collections found.
              </p>
            ) : (
              <div style={{ maxHeight: "300px", overflowY: "auto" }}>
                {availableCollections.map((col) => (
                  <div key={col.id} style={productRow}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: "600", fontSize: "14px", color: "#1e293b" }}>{col.title}</div>
                      <div style={{ color: "#64748b", fontSize: "12px" }}>handle: {col.handle}</div>
                    </div>
                    <Form method="post">
                      <input type="hidden" name="intent" value="addCollection" />
                      <input type="hidden" name="shopifyCollectionId" value={col.id} />
                      <input type="hidden" name="shopifyHandle" value={col.handle} />
                      <input type="hidden" name="collectionTitle" value={col.title} />
                      <button type="submit" style={addBtn} disabled={saving}>+ Add</button>
                    </Form>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── TAB 3: TAG-BASED MAPPING ────────────────────────────────────── */}
      {activeTab === "tags" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
          {/* Assigned Tags */}
          <div style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
              <h3 style={cardHead}>Assigned Product Tags ({fitment.tags.length})</h3>
              <span style={{ fontSize: "12px", color: "#059669", fontWeight: "700", background: "#ecfdf5", padding: "2px 8px", borderRadius: "10px" }}>Tag-Based</span>
            </div>
            <p style={{ fontSize: "13px", color: "#64748b", marginTop: 0, marginBottom: "16px" }}>
              Any product tagged with these strings in Shopify will be matched to <strong>{fitment.year} {fitment.make} {fitment.model}</strong>.
            </p>

            {fitment.tags.length === 0 ? (
              <p style={{ color: "#64748b", fontSize: "14px", fontStyle: "italic", padding: "20px 0", textAlign: "center" }}>
                No product tags assigned to this fitment yet.
              </p>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", padding: "10px 0" }}>
                {fitment.tags.map((t) => (
                  <div
                    key={t.id}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "8px",
                      background: "#f0fdf4",
                      border: "1px solid #bbf7d0",
                      padding: "6px 12px",
                      borderRadius: "20px",
                    }}
                  >
                    <span style={{ fontWeight: "700", fontSize: "13px", color: "#166534" }}>#{t.tag}</span>
                    <Form method="post" style={{ display: "inline" }}>
                      <input type="hidden" name="intent" value="removeTag" />
                      <input type="hidden" name="id" value={t.id} />
                      <input type="hidden" name="tag" value={t.tag} />
                      <button
                        type="submit"
                        disabled={saving}
                        style={{
                          background: "none",
                          border: "none",
                          color: "#991b1b",
                          fontWeight: "bold",
                          cursor: "pointer",
                          fontSize: "12px",
                          padding: "0 2px",
                        }}
                      >
                        ✕
                      </button>
                    </Form>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Add Tag Form */}
          <div style={card}>
            <h3 style={cardHead}>Add Product Tag</h3>
            <p style={{ fontSize: "13px", color: "#64748b", marginTop: 0, marginBottom: "16px" }}>
              Enter a Shopify product tag (e.g. <code>bmw-m2</code> or <code>2000-bmw</code>). All products with this tag will match this fitment.
            </p>

            <Form method="post">
              <input type="hidden" name="intent" value="addTag" />
              <div style={{ marginBottom: "14px" }}>
                <label style={{ display: "block", fontSize: "13px", fontWeight: "700", color: "#334155", marginBottom: "6px" }}>
                  Product Tag Name
                </label>
                <div style={{ display: "flex", gap: "8px" }}>
                  <input
                    name="tag"
                    value={customTagInput}
                    onChange={(e) => setCustomTagInput(e.target.value)}
                    placeholder="e.g. bmw-m2-performance"
                    style={{ flex: 1, padding: "10px 14px", border: "1px solid #cbd5e1", borderRadius: "8px", fontSize: "14px", outline: "none" }}
                  />
                  <button
                    type="submit"
                    disabled={saving || !customTagInput.trim()}
                    style={primaryBtnStyle}
                    onClick={() => setTimeout(() => setCustomTagInput(""), 100)}
                  >
                    + Add Tag
                  </button>
                </div>
              </div>
            </Form>

            <div style={{ background: "#f8fafc", padding: "14px", borderRadius: "8px", border: "1px solid #e2e8f0", marginTop: "20px" }}>
              <strong style={{ fontSize: "12px", color: "#475569", display: "block", marginBottom: "4px" }}>Pro-Tip for Tag-Based Fitment:</strong>
              <p style={{ margin: 0, fontSize: "12px", color: "#64748b" }}>
                Using tags allows you to bulk-associate products in Shopify without manually picking every product inside the app. Simply tag your products in Shopify Admin and add the tag here.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const card = {
  background: "#ffffff",
  border: "1px solid #e2e8f0",
  borderRadius: "12px",
  padding: "20px",
  boxShadow: "0 2px 8px rgba(0,0,0,0.02)",
};

const cardHead = { fontSize: "16px", fontWeight: "700", margin: "0 0 8px", color: "#0f172a" };

const productRow = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "12px",
  padding: "10px 0",
  borderBottom: "1px solid #f1f5f9",
};

const removeBtn = {
  background: "#fee2e2",
  color: "#991b1b",
  border: "none",
  padding: "5px 12px",
  borderRadius: "6px",
  cursor: "pointer",
  fontWeight: "700",
  fontSize: "12px",
};

const addBtn = {
  background: "#dcfce7",
  color: "#166534",
  border: "1px solid #bbf7d0",
  padding: "6px 14px",
  borderRadius: "6px",
  cursor: "pointer",
  fontWeight: "700",
  fontSize: "13px",
};

const aiBtn = {
  background: "#6b21a8",
  color: "#ffffff",
  border: "none",
  padding: "8px 14px",
  borderRadius: "6px",
  fontWeight: "600",
  fontSize: "13px",
};

const primaryBtnStyle = {
  background: "#008060",
  color: "#ffffff",
  border: "none",
  padding: "10px 18px",
  borderRadius: "8px",
  fontWeight: "700",
  fontSize: "14px",
  cursor: "pointer",
};

const badgeStyle = (color, bg) => ({
  display: "inline-flex",
  alignItems: "center",
  background: bg,
  color: color,
  padding: "4px 12px",
  borderRadius: "14px",
  fontWeight: "700",
  fontSize: "12px",
});

const tabButtonStyle = (isActive) => ({
  background: isActive ? "#ffffff" : "transparent",
  color: isActive ? "#008060" : "#64748b",
  border: isActive ? "1px solid #cbd5e1" : "none",
  padding: "8px 16px",
  borderRadius: "8px",
  fontSize: "14px",
  fontWeight: isActive ? "700" : "600",
  cursor: "pointer",
  boxShadow: isActive ? "0 1px 3px rgba(0,0,0,0.05)" : "none",
  transition: "all 0.15s ease",
});
