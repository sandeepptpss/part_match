import { redirect, useLoaderData, Form, useNavigation, useActionData, Link } from "react-router";
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
    include: { products: true },
  });

  if (!fitment) {
    throw new Response("Fitment record not found", { status: 404 });
  }

  // Fetch all products from Shopify for the picker
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
    }
  `);
  const shopifyData = await shopifyRes.json();
  const shopifyProducts = shopifyData.data?.products?.nodes ?? [];

  const shopPlan = await getShopPlan(session.shop);
  const canUseAi = planLimits(shopPlan.plan).aiFitmentSuggestions;

  return json({ fitment, shopifyProducts, canUseAi, aiConfigured: isAiConfigured() });
};

export const action = async ({ request, params }) => {
  const { session, admin } = await authenticate.admin(request);
  const fitmentId = parseInt(params.id, 10);
  const formData = await request.formData();
  const intent = formData.get("intent");

  // Verify ownership
  const fitment = await prisma.fitmentRecord?.findFirst({
    where: { id: fitmentId, shop: session.shop },
    include: { products: true },
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

  if (intent === "add") {
    const productId = formData.get("shopifyProductId")?.toString();
    const handle = formData.get("shopifyHandle")?.toString() || "";
    const title = formData.get("productTitle")?.toString() || "";

    if (!productId) return json({ error: "No product selected" });

    await prisma.fitmentProduct?.upsert({
      where: { fitmentId_shopifyProductId: { fitmentId, shopifyProductId: productId } },
      create: { fitmentId, shopifyProductId: productId, shopifyHandle: handle, productTitle: title },
      update: { shopifyHandle: handle, productTitle: title },
    });
  }

  if (intent === "remove") {
    const id = parseInt(formData.get("id"), 10);
    // fitmentId is already verified to belong to this shop above
    await prisma.fitmentProduct?.deleteMany({ where: { id, fitmentId } });
  }

  return json({ ok: true });
};

export default function FitmentProducts({ params }) {
  const { fitment, shopifyProducts, canUseAi, aiConfigured } = useLoaderData();
  const navigation = useNavigation();
  const actionData = useActionData();
  const saving = navigation.state !== "idle";
  const aiLoading = navigation.state !== "idle" && navigation.formData?.get("intent") === "aiSuggest";

  // IDs already assigned
  const assignedIds = new Set(fitment.products.map((p) => p.shopifyProductId));
  const available = shopifyProducts.filter((p) => !assignedIds.has(p.id));

  const aiResult = actionData?.intent === "aiSuggest" ? actionData : null;
  const suggestionMap = new Map((aiResult?.suggestions ?? []).map((s) => [s.shopifyProductId, s]));

  // Suggested products float to the top, highest confidence first.
  const sortedAvailable = [...available].sort((a, b) => {
    const confA = suggestionMap.get(a.id)?.confidence ?? -1;
    const confB = suggestionMap.get(b.id)?.confidence ?? -1;
    return confB - confA;
  });

  return (
    <div style={{ padding: "20px", maxWidth: "900px", margin: "0 auto" }}>
      <Link to="/app/fitment" style={{ color: "#2c6ecb", fontSize: "14px" }}>← Back to Fitment Records</Link>

      <div style={{ margin: "16px 0 24px" }}>
        <h1 style={{ fontSize: "22px", fontWeight: "700", margin: "0 0 4px" }}>
          {fitment.year} {fitment.make} {fitment.model}
        </h1>
        <p style={{ color: "#6d7175", margin: 0 }}>Manage compatible products for this fitment</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
        {/* Assigned Products */}
        <div style={card}>
          <h3 style={cardHead}>Assigned Products ({fitment.products.length})</h3>
          {fitment.products.length === 0 ? (
            <p style={{ color: "#6d7175", fontSize: "14px" }}>No products assigned yet.</p>
          ) : (
            fitment.products.map((p) => (
              <div key={p.id} style={productRow}>
                <div>
                  <div style={{ fontWeight: "500", fontSize: "14px" }}>{p.productTitle || p.shopifyHandle || p.shopifyProductId}</div>
                  <div style={{ color: "#6d7175", fontSize: "12px" }}>{p.shopifyHandle}</div>
                </div>
                <Form method="post">
                  <input type="hidden" name="intent" value="remove" />
                  <input type="hidden" name="id" value={p.id} />
                  <button type="submit" style={removeBtn} disabled={saving}>✕</button>
                </Form>
              </div>
            ))
          )}
        </div>

        {/* Available Products */}
        <div style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
            <h3 style={{ ...cardHead, margin: 0 }}>Add Products</h3>
            <Form method="post">
              <input type="hidden" name="intent" value="aiSuggest" />
              <button
                type="submit"
                disabled={saving || !canUseAi}
                title={!canUseAi ? "AI Suggestions are available on the Enterprise plan" : ""}
                style={{ ...aiBtn, opacity: !canUseAi ? 0.5 : 1, cursor: !canUseAi ? "not-allowed" : "pointer" }}
              >
                {aiLoading ? "Analyzing…" : "AI Suggest Products"}
              </button>
            </Form>
          </div>

          {!canUseAi && (
            <p style={{ fontSize: "12px", color: "#6d7175", margin: "0 0 14px" }}>
              AI-Powered Fitment Suggestions is an Enterprise plan feature. <Link to="/app/plans" style={{ color: "#2c6ecb" }}>Upgrade to unlock</Link>.
            </p>
          )}
          {canUseAi && !aiConfigured && (
            <p style={{ fontSize: "12px", color: "#8a6d00", background: "#fff8e1", padding: "8px 10px", borderRadius: "6px", margin: "0 0 14px" }}>
              Demo Mode: ANTHROPIC_API_KEY is not set on the server, so AI Suggest will show simulated keyword-matched results for testing. Add a real key for actual AI-powered matching.
            </p>
          )}
          {aiResult?.error && (
            <p style={{ fontSize: "12px", color: "#c0392b", background: "#fdecea", padding: "8px 10px", borderRadius: "6px", margin: "0 0 14px" }}>
              {aiResult.error}
            </p>
          )}
          {aiResult?.suggestions && !aiResult.error && (
            <p style={{ fontSize: "12px", color: aiResult.mock ? "#8a6d00" : "#137333", background: aiResult.mock ? "#fff8e1" : "#e6f4ea", padding: "8px 10px", borderRadius: "6px", margin: "0 0 14px" }}>
              {aiResult.mock ? "Demo results (keyword match, no API key): " : "AI results: "}
              {aiResult.suggestions.length > 0
                ? `Found ${aiResult.suggestions.length} likely match${aiResult.suggestions.length === 1 ? "" : "es"} for ${fitment.year} ${fitment.make} ${fitment.model}.`
                : "No likely matches found among current store products."}
            </p>
          )}

          {available.length === 0 ? (
            <p style={{ color: "#6d7175", fontSize: "14px" }}>All products already assigned.</p>
          ) : (
            <div style={{ maxHeight: "400px", overflowY: "auto" }}>
              {sortedAvailable.map((p) => {
                const suggestion = suggestionMap.get(p.id);
                return (
                  <div key={p.id} style={productRow}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: "500", fontSize: "14px" }}>{p.title}</div>
                      <div style={{ color: "#6d7175", fontSize: "12px" }}>{p.handle}</div>
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
    </div>
  );
}

const card = {
  background: "#fff",
  border: "1px solid #e1e3e5",
  borderRadius: "8px",
  padding: "16px",
};
const cardHead = { fontSize: "15px", fontWeight: "600", margin: "0 0 14px" };
const productRow = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "12px",
  padding: "10px 0",
  borderBottom: "1px solid #f1f2f3",
};
const removeBtn = {
  background: "#f8d7da",
  color: "#721c24",
  border: "none",
  padding: "4px 10px",
  borderRadius: "4px",
  cursor: "pointer",
  fontWeight: "600",
};
const addBtn = {
  background: "#d4edda",
  color: "#155724",
  border: "none",
  padding: "5px 12px",
  borderRadius: "4px",
  cursor: "pointer",
  fontWeight: "500",
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
