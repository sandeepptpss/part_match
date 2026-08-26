import { redirect } from "react-router";
const json = (data, init) => Response.json(data, init);
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const tab = url.searchParams.get("tab");
  if (tab === "universal") {
    return redirect("/app/products/universal");
  }

  let fitmentProductCount = 0;
  try {
    fitmentProductCount = await prisma.fitmentProduct.count({
      where: { fitment: { shop } },
    });
  } catch (err) {
    console.error("[fitmentProduct loader error]", err);
  }

  return json({ fitmentProductCount });
};

export default function ProductsIndex() {
  const { fitmentProductCount } = useLoaderData();

  return (
    <div style={{ padding: "20px", maxWidth: "900px", margin: "0 auto" }}>
      <h1 style={{ fontSize: "22px", fontWeight: "700", margin: "0 0 20px" }}>Products</h1>

      {/* Tabs */}
      <div style={{ display: "flex", gap: "4px", marginBottom: "24px", background: "#f4f6f8", borderRadius: "8px", padding: "4px", width: "fit-content" }}>
        <a href="/app/products" style={tabStyle(true)}>Fitment Products</a>
        <a href="/app/products/universal" style={tabStyle(false)}>Universal Products</a>
      </div>

      <div style={{ background: "#fff", border: "1px solid #e1e3e5", borderRadius: "8px", padding: "24px" }}>
        <h3 style={{ margin: "0 0 8px", fontSize: "16px", fontWeight: "600" }}>Fitment-Mapped Products</h3>
        <p style={{ color: "#6d7175", margin: "0 0 16px", fontSize: "14px" }}>
          {fitmentProductCount} product mapping(s) across all fitment records.
        </p>
        <p style={{ color: "#6d7175", fontSize: "14px", margin: 0 }}>
          To manage which products are linked to each vehicle, go to{" "}
          <a href="/app/fitment" style={{ color: "#008060", fontWeight: "600" }}>Fitment Records</a> and click <strong>Products</strong> on a record.
        </p>
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
