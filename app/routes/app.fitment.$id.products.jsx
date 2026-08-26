import { redirect } from "react-router";
const json = (data, init) => Response.json(data, init);
import { useLoaderData, Form, useNavigation, useActionData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

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

  return json({ fitment, shopifyProducts });
};

export const action = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const fitmentId = parseInt(params.id, 10);
  const formData = await request.formData();
  const intent = formData.get("intent");

  // Verify ownership
  const fitment = await prisma.fitmentRecord?.findFirst({
    where: { id: fitmentId, shop: session.shop },
  });
  if (!fitment) throw new Response("Not found", { status: 404 });

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
  const { fitment, shopifyProducts } = useLoaderData();
  const navigation = useNavigation();
  const saving = navigation.state !== "idle";

  // IDs already assigned
  const assignedIds = new Set(fitment.products.map((p) => p.shopifyProductId));
  const available = shopifyProducts.filter((p) => !assignedIds.has(p.id));

  return (
    <div style={{ padding: "20px", maxWidth: "900px", margin: "0 auto" }}>
      <a href="/app/fitment" style={{ color: "#2c6ecb", fontSize: "14px" }}>← Back to Fitment Records</a>

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
          <h3 style={cardHead}>Add Products</h3>
          {available.length === 0 ? (
            <p style={{ color: "#6d7175", fontSize: "14px" }}>All products already assigned.</p>
          ) : (
            <div style={{ maxHeight: "400px", overflowY: "auto" }}>
              {available.map((p) => (
                <div key={p.id} style={productRow}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: "500", fontSize: "14px" }}>{p.title}</div>
                    <div style={{ color: "#6d7175", fontSize: "12px" }}>{p.handle}</div>
                  </div>
                  <Form method="post">
                    <input type="hidden" name="intent" value="add" />
                    <input type="hidden" name="shopifyProductId" value={p.id} />
                    <input type="hidden" name="shopifyHandle" value={p.handle} />
                    <input type="hidden" name="productTitle" value={p.title} />
                    <button type="submit" style={addBtn} disabled={saving}>+ Add</button>
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
