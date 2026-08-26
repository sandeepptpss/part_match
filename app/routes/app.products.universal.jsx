const json = (data, init) => Response.json(data, init);
import { useLoaderData, Form, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  let universalProducts = [];
  try {
    universalProducts = await prisma.universalProduct.findMany({
      where: { shop },
      orderBy: { productTitle: "asc" },
    });
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

  return json({ universalProducts, available });
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  try {
    if (intent === "add") {
      const shopifyProductId = formData.get("shopifyProductId")?.toString();
      const shopifyHandle = formData.get("shopifyHandle")?.toString() || "";
      const productTitle = formData.get("productTitle")?.toString() || "";
      await prisma.universalProduct.upsert({
        where: { shop_shopifyProductId: { shop, shopifyProductId } },
        create: { shop, shopifyProductId, shopifyHandle, productTitle },
        update: { shopifyHandle, productTitle },
      });
    }

    if (intent === "remove") {
      const id = parseInt(formData.get("id"), 10);
      await prisma.universalProduct.deleteMany({ where: { id, shop } });
    }
  } catch (err) {
    console.error("[universalProducts action error]", err);
  }

  return json({ ok: true });
};

export default function UniversalProducts() {
  const { universalProducts, available } = useLoaderData();
  const navigation = useNavigation();
  const saving = navigation.state !== "idle";

  return (
    <div style={{ padding: "20px", maxWidth: "900px", margin: "0 auto" }}>
      <h1 style={{ fontSize: "22px", fontWeight: "700", margin: "0 0 20px" }}>Products</h1>

      {/* Tabs */}
      <div style={{ display: "flex", gap: "4px", marginBottom: "24px", background: "#f4f6f8", borderRadius: "8px", padding: "4px", width: "fit-content" }}>
        <a href="/app/products" style={tabStyle(false)}>Fitment Products</a>
        <a href="/app/products/universal" style={tabStyle(true)}>Universal Products</a>
      </div>

      <div style={{ marginBottom: "20px" }}>
        <p style={{ color: "#6d7175", fontSize: "14px", margin: 0 }}>
          Universal products appear in <strong>all</strong> search results regardless of the selected vehicle.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
        {/* Current Universal Products */}
        <div style={card}>
          <h3 style={cardHead}>Universal Products ({universalProducts.length})</h3>
          {universalProducts.length === 0 ? (
            <p style={{ color: "#6d7175", fontSize: "14px" }}>No universal products yet.</p>
          ) : (
            universalProducts.map((p) => (
              <div key={p.id} style={row}>
                <div>
                  <div style={{ fontWeight: "500", fontSize: "14px" }}>{p.productTitle || p.shopifyHandle}</div>
                  <div style={{ color: "#6d7175", fontSize: "12px" }}>{p.shopifyHandle}</div>
                </div>
                <Form method="post">
                  <input type="hidden" name="intent" value="remove" />
                  <input type="hidden" name="id" value={p.id} />
                  <button type="submit" disabled={saving} style={removeBtn}>✕ Remove</button>
                </Form>
              </div>
            ))
          )}
        </div>

        {/* Add Products */}
        <div style={card}>
          <h3 style={cardHead}>Add Universal Product</h3>
          {available.length === 0 ? (
            <p style={{ color: "#6d7175", fontSize: "14px" }}>All products already marked as universal.</p>
          ) : (
            <div style={{ maxHeight: "420px", overflowY: "auto" }}>
              {available.map((p) => (
                <div key={p.id} style={row}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: "500", fontSize: "14px" }}>{p.title}</div>
                    <div style={{ color: "#6d7175", fontSize: "12px" }}>{p.handle}</div>
                  </div>
                  <Form method="post">
                    <input type="hidden" name="intent" value="add" />
                    <input type="hidden" name="shopifyProductId" value={p.id} />
                    <input type="hidden" name="shopifyHandle" value={p.handle} />
                    <input type="hidden" name="productTitle" value={p.title} />
                    <button type="submit" disabled={saving} style={addBtn}>+ Mark Universal</button>
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
  display: "inline-block",
  padding: "8px 16px",
  borderRadius: "6px",
  textDecoration: "none",
  fontSize: "14px",
  fontWeight: active ? "600" : "500",
  background: active ? "#fff" : "transparent",
  color: active ? "#008060" : "#6d7175",
  boxShadow: active ? "0 1px 3px rgba(0,0,0,.1)" : "none",
});

const card = { background: "#fff", border: "1px solid #e1e3e5", borderRadius: "8px", padding: "16px" };
const cardHead = { fontSize: "15px", fontWeight: "600", margin: "0 0 14px" };
const row = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", padding: "10px 0", borderBottom: "1px solid #f1f2f3" };
const removeBtn = { background: "#f8d7da", color: "#721c24", border: "none", padding: "5px 10px", borderRadius: "4px", cursor: "pointer", fontSize: "13px" };
const addBtn = { background: "#d4edda", color: "#155724", border: "none", padding: "5px 12px", borderRadius: "4px", cursor: "pointer", fontSize: "13px", whiteSpace: "nowrap" };
