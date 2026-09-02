import { useEffect } from "react";
import { useLoaderData, Link, useNavigate } from "react-router";
const json = (data, init) => Response.json(data, init);
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getShopPlan, planLimits } from "../plans.server";

// GET /app/fitment/export?format=csv|aces_csv|aces_xml
export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const format = url.searchParams.get("format") || "csv"; // "csv" | "aces_csv" | "aces_xml"

  const { plan } = await getShopPlan(shop);
  const limits = planLimits(plan);
  if (!limits.csvImportExport) {
    if (url.searchParams.get("raw") === "true") {
      return json({
        allowed: false,
        message: `CSV & ACES Export requires the Growth Professional plan or above. Your current plan is ${limits.label}.`,
      }, { status: 403 });
    }
    return json({
      allowed: false,
      message: `CSV & ACES Export requires the Growth Professional plan or above. Your current plan is ${limits.label}.`,
    });
  }

  const records = await prisma.fitmentRecord?.findMany({
    where: { shop },
    include: { products: true, collections: true, tags: true, skus: true },
    orderBy: [{ year: "desc" }, { make: "asc" }, { model: "asc" }],
  });

  let outputContent = "";
  let filename = "";
  let mimeType = "text/csv";

  if (!records || records.length === 0) {
    if (url.searchParams.get("raw") === "true") {
      return new Response("No fitment records found to export.", { status: 400 });
    }
    return json({
      allowed: false,
      csv: "",
      filename: "",
      format,
      mimeType,
      count: 0,
      message: "No fitment records found in your catalog. Please add or import fitment records before exporting.",
    });
  }

  if (format === "aces_xml") {
    mimeType = "application/xml";
    filename = `aces-catalog-export-${new Date().toISOString().slice(0, 10)}.xml`;

    let xml = `<?xml version="1.0" encoding="utf-8"?>\n<ACES version="3.2">\n  <Header>\n    <Company>${xmlEsc(shop)}</Company>\n    <SenderName>PartMatch Fitment Engine</SenderName>\n    <GeneratedDate>${new Date().toISOString()}</GeneratedDate>\n  </Header>\n`;

    let appId = 1;
    records.forEach((r) => {
      const parts = [];
      r.products.forEach((p) => parts.push(p.shopifyHandle));
      r.skus.forEach((s) => parts.push(s.sku));
      if (parts.length === 0) parts.push("");

      parts.forEach((partNum) => {
        xml += `  <App action="A" id="${appId++}">\n`;
        xml += `    <BaseVehicleYear>${xmlEsc(r.year)}</BaseVehicleYear>\n`;
        xml += `    <MakeName>${xmlEsc(r.make)}</MakeName>\n`;
        xml += `    <ModelName>${xmlEsc(r.model)}</ModelName>\n`;
        if (r.trim) xml += `    <SubModelName>${xmlEsc(r.trim)}</SubModelName>\n`;
        if (partNum) xml += `    <PartNumber>${xmlEsc(partNum)}</PartNumber>\n`;
        xml += `  </App>\n`;
      });
    });

    xml += `</ACES>`;
    outputContent = xml;
  } else if (format === "aces_csv") {
    filename = `aces-fitment-export-${new Date().toISOString().slice(0, 10)}.csv`;
    const rows = ["YearID,MakeName,ModelName,SubModelName,PartNumber,BrandID"];

    records.forEach((r) => {
      const parts = [];
      r.products.forEach((p) => parts.push(p.shopifyHandle));
      r.skus.forEach((s) => parts.push(s.sku));
      if (parts.length === 0) parts.push("");

      parts.forEach((partNum) => {
        rows.push(`${r.year},${csvEsc(r.make)},${csvEsc(r.model)},${csvEsc(r.trim || "")},${csvEsc(partNum)},PARTMATCH`);
      });
    });

    outputContent = rows.join("\n");
  } else {
    filename = `fitment-export-${new Date().toISOString().slice(0, 10)}.csv`;
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

    outputContent = rows.join("\n");
  }

  if (url.searchParams.get("raw") === "true") {
    return new Response(outputContent, {
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  return json({ allowed: true, csv: outputContent, filename, format, mimeType, count: records.length });
}

export default function FitmentExport() {
  const data = useLoaderData();

  const triggerDownload = (content, fname, mime) => {
    if (!content) return;
    const blob = new Blob([content], { type: `${mime || "text/csv"};charset=utf-8;` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fname || data.filename || "fitment-export.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    if (data?.allowed && data?.csv) {
      triggerDownload(data.csv, data.filename, data.mimeType);
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
        <div style={{ width: "56px", height: "56px", background: "#ecfdf5", color: "#10b981", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px", fontSize: "28px", fontWeight: "bold" }}>
          ✓
        </div>
        <h1 style={{ fontSize: "24px", fontWeight: "800", color: "#0f172a", margin: "0 0 8px" }}>Catalog Export Ready</h1>
        <p style={{ color: "#64748b", margin: "0 0 24px", fontSize: "14px" }}>
          Exported {data.count} fitment records ({data.filename}). Your download started automatically.
        </p>

        <div style={{ display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap", marginBottom: "24px" }}>
          <a
            href="/app/fitment/export?format=csv&raw=true"
            style={{ background: "#0f172a", color: "#ffffff", padding: "10px 18px", borderRadius: "8px", fontSize: "13px", fontWeight: "700", textDecoration: "none" }}
          >
            Standard CSV Export
          </a>
          <a
            href="/app/fitment/export?format=aces_csv&raw=true"
            style={{ background: "#059669", color: "#ffffff", padding: "10px 18px", borderRadius: "8px", fontSize: "13px", fontWeight: "700", textDecoration: "none" }}
          >
            ACES Standard CSV Export
          </a>
          <a
            href="/app/fitment/export?format=aces_xml&raw=true"
            style={{ background: "#2563eb", color: "#ffffff", padding: "10px 18px", borderRadius: "8px", fontSize: "13px", fontWeight: "700", textDecoration: "none" }}
          >
            Enterprise ACES XML Export
          </a>
        </div>

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
  );
}

function csvEsc(val) {
  if (!val) return "";
  const str = String(val);
  return str.includes(",") || str.includes('"') || str.includes("\n")
    ? `"${str.replace(/"/g, '""')}"`
    : str;
}

function xmlEsc(val) {
  if (!val) return "";
  return String(val)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

