import { useEffect } from "react";
import { useLoaderData, Link, useNavigate } from "react-router";
const json = (data, init) => Response.json(data, init);
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getShopPlan, planLimits } from "../plans.server";

// GET /app/fitment/export
export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);

  const { plan } = await getShopPlan(shop);
  const limits = planLimits(plan);
  if (!limits.csvImportExport) {
    return json({
      allowed: false,
      message: `CSV Export requires the Growth Professional plan or above. Your current plan is ${limits.label}.`,
    });
  }

  const records = await prisma.fitmentRecord?.findMany({
    where: { shop },
    include: { products: true, collections: true, tags: true, skus: true },
    orderBy: [{ year: "desc" }, { make: "asc" }, { model: "asc" }],
  });

  const rows = ["year,make,model,trim,product_handle,product_title,collection_handle,tag,sku"];

  records.forEach((r) => {
    const hasAny = r.products.length > 0 || r.collections.length > 0 || r.tags.length > 0 || r.skus.length > 0;
    if (!hasAny) {
      rows.push(`${r.year},${csvEsc(r.make)},${csvEsc(r.model)},${csvEsc(r.trim || "")},,,,,`);
    } else {
      r.products.forEach((p) => {
        rows.push(
          `${r.year},${csvEsc(r.make)},${csvEsc(r.model)},${csvEsc(r.trim || "")},${csvEsc(p.shopifyHandle)},${csvEsc(p.productTitle)},,,`
        );
      });
      r.collections.forEach((c) => {
        rows.push(
          `${r.year},${csvEsc(r.make)},${csvEsc(r.model)},${csvEsc(r.trim || "")},,,${csvEsc(c.shopifyHandle)},,`
        );
      });
      r.tags.forEach((t) => {
        rows.push(
          `${r.year},${csvEsc(r.make)},${csvEsc(r.model)},${csvEsc(r.trim || "")},,,,${csvEsc(t.tag)},`
        );
      });
      r.skus.forEach((s) => {
        rows.push(
          `${r.year},${csvEsc(r.make)},${csvEsc(r.model)},${csvEsc(r.trim || "")},,,,,${csvEsc(s.sku)}`
        );
      });
    }
  });

  const csv = rows.join("\n");
  const filename = `fitment-export-${new Date().toISOString().slice(0, 10)}.csv`;

  if (url.searchParams.get("raw") === "true") {
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  return json({ allowed: true, csv, filename, count: records.length });
}

export default function FitmentExport() {
  const data = useLoaderData();
  const navigate = useNavigate();

  const triggerDownload = () => {
    if (!data?.csv) return;
    const blob = new Blob([data.csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = data.filename || "fitment-export.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    if (data?.allowed && data?.csv) {
      triggerDownload();
    }
  }, [data]);

  if (!data?.allowed) {
    return (
      <div style={{ padding: "32px 24px", maxWidth: "700px", margin: "40px auto", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
        <div style={{ background: "#fffbe6", border: "1px solid #ffe58f", color: "#78350f", padding: "24px", borderRadius: "12px" }}>
          <strong style={{ color: "#b45309", fontSize: "16px", display: "block", marginBottom: "6px" }}>Growth Professional Feature</strong>
          <p style={{ margin: "0 0 16px", fontSize: "14px" }}>{data?.message}</p>
          <Link to="/app/plans" style={{ color: "#2563eb", fontWeight: "700", textDecoration: "none" }}>Upgrade Plan →</Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "32px 24px", maxWidth: "700px", margin: "40px auto", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", color: "#202223" }}>
      <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "16px", padding: "32px", textAlign: "center", boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.05)" }}>
        <div style={{ width: "48px", height: "48px", background: "#ecfdf5", color: "#10b981", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px", fontSize: "24px", fontWeight: "bold" }}>
          ✓
        </div>
        <h1 style={{ fontSize: "22px", fontWeight: "800", color: "#0f172a", margin: "0 0 8px" }}>Fitment CSV Export Ready</h1>
        <p style={{ color: "#64748b", margin: "0 0 24px", fontSize: "14px" }}>
          Generated {data.count} fitment records ({data.filename}). Your download should start automatically.
        </p>

        <div style={{ display: "flex", gap: "12px", justifyContent: "center" }}>
          <button
            type="button"
            onClick={triggerDownload}
            style={{
              background: "#008060",
              color: "#ffffff",
              border: "none",
              padding: "11px 22px",
              borderRadius: "8px",
              fontSize: "14px",
              fontWeight: "700",
              cursor: "pointer",
            }}
          >
            Download CSV Again
          </button>
          <Link
            to="/app/fitment"
            style={{
              display: "inline-flex",
              alignItems: "center",
              background: "#ffffff",
              color: "#475569",
              border: "1px solid #cbd5e1",
              padding: "11px 20px",
              borderRadius: "8px",
              fontSize: "14px",
              fontWeight: "600",
              textDecoration: "none",
            }}
          >
            ← Back to Fitment Catalog
          </Link>
        </div>
      </div>
    </div>
  );
}

function csvEsc(val) {
  if (!val) return "";
  const str = String(val);
  return str.includes(",") || str.includes('"') || str.includes("\n")
    ? `"${str.replace(/"/g, '""')}"`
    : str;
}
