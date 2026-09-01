import { useState } from "react";
import { redirect, useLoaderData, Form, useActionData, useNavigation, Link } from "react-router";
const json = (data, init) => Response.json(data, init);
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getShopPlan, planLimits } from "../plans.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const { plan } = await getShopPlan(session.shop);
  const limits = planLimits(plan);
  return json({ planAllowsImport: limits.csvImportExport, planLabel: limits.label });
};

export const action = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  const { plan } = await getShopPlan(shop);
  const limits = planLimits(plan);
  if (!limits.csvImportExport) {
    return json({
      error: `CSV Bulk Import is available on the Growth Professional plan and above. Upgrade your plan to import records.`,
      results: null,
    });
  }

  const formData = await request.formData();
  const csvText = formData.get("csv")?.toString() || "";

  if (!csvText.trim()) {
    return json({ error: "No CSV data provided", results: null });
  }

  const lines = csvText.trim().split("\n").filter((l) => l.trim());
  if (lines.length < 2) {
    return json({ error: "CSV must have a header row and at least one data row", results: null });
  }

  // Parse header
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/["']/g, ""));
  let yearIdx = headers.indexOf("year");
  let makeIdx = headers.indexOf("make");
  let modelIdx = headers.indexOf("model");
  let trimIdx = headers.indexOf("trim");
  let handleIdx = headers.indexOf("product_handle");
  const collectionIdx = headers.indexOf("collection_handle");
  const tagIdx = headers.indexOf("tag");
  const skuIdx = headers.indexOf("sku");

  // ACES / PIES Auto-Detection
  if (yearIdx === -1) yearIdx = headers.indexOf("yearid") !== -1 ? headers.indexOf("yearid") : headers.indexOf("modelyear");
  if (makeIdx === -1) makeIdx = headers.indexOf("makename") !== -1 ? headers.indexOf("makename") : headers.indexOf("make_name");
  if (modelIdx === -1) modelIdx = headers.indexOf("modelname") !== -1 ? headers.indexOf("modelname") : headers.indexOf("model_name");
  if (trimIdx === -1) trimIdx = headers.indexOf("enginebase") !== -1 ? headers.indexOf("enginebase") : headers.indexOf("submodelname");
  if (handleIdx === -1) handleIdx = headers.indexOf("partnumber") !== -1 ? headers.indexOf("partnumber") : headers.indexOf("product_handle");

  if (yearIdx === -1 || makeIdx === -1 || modelIdx === -1) {
    return json({
      error: `Missing required columns. Found: ${headers.join(", ")}. Required: year, make, model (or ACES columns: YearID, MakeName, ModelName, PartNumber)`,
      results: null,
    });
  }

  const results = { created: 0, skipped: 0, errors: [] };
  const handleCache = new Map();
  let recordCount = Number.isFinite(limits.fitmentLimit)
    ? await prisma.fitmentRecord.count({ where: { shop } })
    : 0;
  let limitReached = false;

  async function resolveHandle(handle) {
    if (handleCache.has(handle)) return handleCache.get(handle);
    const res = await admin.graphql(
      `query($handle: String!) { productByHandle(handle: $handle) { id title handle } }`,
      { variables: { handle } },
    );
    const data = await res.json();
    const product = data.data?.productByHandle ?? null;
    handleCache.set(handle, product);
    return product;
  }

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim().replace(/^["']|["']$/g, ""));
    const year = cols[yearIdx];
    const make = cols[makeIdx];
    const model = cols[modelIdx];
    const trimVal = trimIdx >= 0 ? cols[trimIdx] || "" : "";
    const handle = handleIdx >= 0 ? cols[handleIdx] : null;
    const collectionHandle = collectionIdx >= 0 ? cols[collectionIdx] : null;
    const tagVal = tagIdx >= 0 ? cols[tagIdx]?.replace(/^#/, "") : null;
    const skuVal = skuIdx >= 0 ? cols[skuIdx] : null;

    if (!year || !make || !model) {
      results.errors.push(`Row ${i + 1}: missing year, make, or model`);
      results.skipped++;
      continue;
    }

    if (limitReached) {
      results.errors.push(`Row ${i + 1}: skipped — ${limits.fitmentLimit.toLocaleString()} fitment record limit for the ${limits.label} plan reached`);
      results.skipped++;
      continue;
    }

    try {
      const existingRecord = Number.isFinite(limits.fitmentLimit)
        ? await prisma.fitmentRecord.findUnique({
            where: { shop_year_make_model_trim: { shop, year, make, model, trim: trimVal } },
          })
        : null;

      if (!existingRecord && Number.isFinite(limits.fitmentLimit) && recordCount >= limits.fitmentLimit) {
        limitReached = true;
        results.errors.push(`Row ${i + 1}: skipped — ${limits.fitmentLimit.toLocaleString()} fitment record limit for the ${limits.label} plan reached`);
        results.skipped++;
        continue;
      }

      const fitment = await prisma.fitmentRecord.upsert({
        where: { shop_year_make_model_trim: { shop, year, make, model, trim: trimVal } },
        create: { shop, year, make, model, trim: trimVal },
        update: {},
      });
      if (!existingRecord) recordCount++;

      if (handle) {
        const product = await resolveHandle(handle);

        if (!product) {
          results.errors.push(`Row ${i + 1}: product handle "${handle}" not found in store — fitment record was still created`);
        } else {
          await prisma.fitmentProduct.upsert({
            where: {
              fitmentId_shopifyProductId: {
                fitmentId: fitment.id,
                shopifyProductId: product.id,
              },
            },
            create: {
              fitmentId: fitment.id,
              shopifyProductId: product.id,
              shopifyHandle: product.handle,
              productTitle: product.title,
            },
            update: {
              shopifyHandle: product.handle,
              productTitle: product.title,
            },
          });
        }
      }

      if (collectionHandle) {
        const keyId = `custom-${collectionHandle}`;
        await prisma.fitmentCollection.upsert({
          where: { fitmentId_shopifyCollectionId: { fitmentId: fitment.id, shopifyCollectionId: keyId } },
          create: { fitmentId: fitment.id, shopifyCollectionId: keyId, shopifyHandle: collectionHandle, collectionTitle: collectionHandle },
          update: { shopifyHandle: collectionHandle },
        });
      }

      if (tagVal) {
        await prisma.fitmentTag.upsert({
          where: { fitmentId_tag: { fitmentId: fitment.id, tag: tagVal } },
          create: { fitmentId: fitment.id, tag: tagVal },
          update: {},
        });
      }

      if (skuVal) {
        await prisma.fitmentSku.upsert({
          where: { fitmentId_sku: { fitmentId: fitment.id, sku: skuVal } },
          create: { fitmentId: fitment.id, sku: skuVal },
          update: {},
        });
      }

      results.created++;
    } catch (err) {
      results.errors.push(`Row ${i + 1}: ${err.message}`);
      results.skipped++;
    }
  }

  return json({ error: null, results });
};

export default function FitmentImport() {
  const { planAllowsImport, planLabel } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const importing = navigation.state !== "idle";

  const [csvContent, setCsvContent] = useState("");
  const [fileName, setFileName] = useState("");
  const [isDragging, setIsDragging] = useState(false);

  const sampleCSV = `year,make,model,trim,product_handle,collection_handle,tag,sku
2025,Arctic Cat,Norseman 400,Base,brake-pad-arctic-cat,,,
2025,Arctic Cat,Norseman 400,LX,,arctic-cat-parts,,
2024,Polaris,Sportsman 850,SP,,,polaris-sportsman-2024,
2026,BMW,M3,Base,,,,SKU-BMW-M3-2026`;

  const handleFileUpload = (file) => {
    if (!file) return;
    if (!file.name.endsWith(".csv") && file.type !== "text/csv") {
      alert("Please upload a valid .csv file.");
      return;
    }
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      setCsvContent(e.target?.result || "");
    };
    reader.readAsText(file);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  const handleDownloadSample = () => {
    const blob = new Blob([sampleCSV], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", "partmatch_sample_fitments.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div style={{ padding: "32px 24px", maxWidth: "860px", margin: "0 auto", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif", color: "#202223" }}>
      <Link to="/app/fitment" style={{ color: "#2563eb", fontSize: "14px", fontWeight: "600", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "4px", marginBottom: "20px" }}>
        ← Back to Fitment Catalog
      </Link>

      <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "16px", padding: "32px", boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.05)" }}>
        <div style={{ borderBottom: "1px solid #f1f5f9", paddingBottom: "20px", marginBottom: "24px" }}>
          <div style={{ display: "flex", alignItems: "center", justify: "space-between" }}>
            <h1 style={{ fontSize: "24px", fontWeight: "800", margin: 0, color: "#0f172a", letterSpacing: "-0.5px" }}>Bulk Import Fitments via CSV</h1>
          </div>
          <p style={{ color: "#64748b", margin: "4px 0 0", fontSize: "14px" }}>
            Upload a CSV file or paste raw CSV formatted fitments to bulk update your product compatibility.
          </p>
        </div>

        {actionData?.error && (
          <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", padding: "14px 18px", borderRadius: "10px", marginBottom: "24px", fontSize: "14px", fontWeight: "500" }}>
            {actionData.error}
          </div>
        )}

        {actionData?.results && (
          <div style={{ background: "#ecfdf5", border: "1px solid #a7f3d0", color: "#047857", padding: "20px", borderRadius: "12px", marginBottom: "24px" }}>
            <strong style={{ fontSize: "16px", display: "block", marginBottom: "8px" }}>Import Operation Complete</strong>
            <div style={{ display: "flex", gap: "16px", margin: "12px 0 0" }}>
              <span style={{ background: "#ffffff", padding: "6px 14px", borderRadius: "8px", fontWeight: "700", border: "1px solid #a7f3d0", fontSize: "13px" }}>
                ✓ Created / Updated: {actionData.results.created}
              </span>
              <span style={{ background: "#ffffff", padding: "6px 14px", borderRadius: "8px", fontWeight: "700", border: "1px solid #a7f3d0", fontSize: "13px", color: "#b45309" }}>
                Skipped: {actionData.results.skipped}
              </span>
            </div>
            {actionData.results.errors.length > 0 && (
              <details style={{ marginTop: "12px" }}>
                <summary style={{ cursor: "pointer", fontWeight: "600" }}>View {actionData.results.errors.length} warning / error details</summary>
                <ul style={{ marginTop: "8px", color: "#b45309", fontSize: "13px" }}>
                  {actionData.results.errors.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              </details>
            )}
          </div>
        )}

        {/* Sample & Download */}
        <div style={{ display: "flex", gap: "12px", alignItems: "center", marginBottom: "24px" }}>
          <details style={{ flex: 1, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "10px", padding: "12px 16px" }}>
            <summary style={{ cursor: "pointer", color: "#2563eb", fontSize: "14px", fontWeight: "700" }}>
              View Standard CSV Header & Rows Format
            </summary>
            <pre style={{ background: "#0f172a", color: "#e2e8f0", padding: "16px", borderRadius: "8px", fontSize: "13px", marginTop: "12px", overflowX: "auto", fontFamily: "monospace" }}>
              {sampleCSV}
            </pre>
          </details>
          <button
            type="button"
            onClick={handleDownloadSample}
            style={{
              background: "#f1f5f9",
              color: "#0f172a",
              border: "1px solid #cbd5e1",
              padding: "12px 18px",
              borderRadius: "10px",
              fontSize: "13px",
              fontWeight: "700",
              cursor: "pointer",
              whiteSpace: "nowrap",
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            Download Sample CSV
          </button>
        </div>

        {!planAllowsImport && (
          <div style={{ background: "#fffbe6", border: "1px solid #ffe58f", color: "#78350f", padding: "20px", borderRadius: "12px", marginBottom: "24px" }}>
            <strong style={{ color: "#b45309", fontSize: "15px", display: "block", marginBottom: "4px" }}>Growth Professional Feature</strong>
            <p style={{ margin: "0 0 12px", fontSize: "14px" }}>
              Bulk CSV Import requires the Growth Professional plan. Upgrade to import thousands of records at once.
            </p>
            <Link to="/app/plans" style={{ color: "#2563eb", fontWeight: "700", fontSize: "14px", textDecoration: "none" }}>Upgrade Plan →</Link>
          </div>
        )}

        {/* File Upload Dropzone */}
        <div style={{ marginBottom: "24px" }}>
          <label style={{ display: "block", fontWeight: "700", color: "#1e293b", marginBottom: "8px", fontSize: "14px" }}>
            Upload CSV File
          </label>
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            style={{
              border: isDragging ? "2px dashed #2563eb" : "2px dashed #cbd5e1",
              background: isDragging ? "#eff6ff" : "#f8fafc",
              borderRadius: "12px",
              padding: "24px",
              textAlign: "center",
              cursor: planAllowsImport ? "pointer" : "not-allowed",
              transition: "all 0.2s ease",
            }}
          >
            <input
              type="file"
              accept=".csv"
              disabled={!planAllowsImport}
              id="csvFileInput"
              onChange={(e) => handleFileUpload(e.target.files?.[0])}
              style={{ display: "none" }}
            />
            <label htmlFor="csvFileInput" style={{ cursor: planAllowsImport ? "pointer" : "not-allowed" }}>
              <div style={{ display: "flex", justifyContent: "center", marginBottom: "8px", color: "#2563eb" }}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                  <polyline points="14 2 14 8 20 8"></polyline>
                  <line x1="12" y1="18" x2="12" y2="12"></line>
                  <line x1="9" y1="15" x2="15" y2="15"></line>
                </svg>
              </div>
              <div style={{ fontSize: "14px", fontWeight: "700", color: "#2563eb" }}>
                {fileName ? `File Selected: ${fileName}` : "Click to browse or Drag & Drop your .CSV file here"}
              </div>
              <div style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>
                Supports standard PartMatch CSV or ACES / PIES automotive exports (.csv)
              </div>
            </label>
          </div>
        </div>

        <Form method="post" aria-disabled={!planAllowsImport}>
          <div style={{ marginBottom: "20px" }}>
            <label style={{ display: "block", fontWeight: "700", color: "#1e293b", marginBottom: "8px", fontSize: "14px" }}>
              CSV Content Data (Auto-filled from file or paste directly)
            </label>
            <textarea
              name="csv"
              rows={8}
              value={csvContent}
              onChange={(e) => setCsvContent(e.target.value)}
              placeholder={sampleCSV}
              disabled={!planAllowsImport}
              style={{
                width: "100%",
                padding: "14px",
                border: "1px solid #cbd5e1",
                borderRadius: "10px",
                fontSize: "13px",
                fontFamily: "monospace",
                boxSizing: "border-box",
                resize: "vertical",
                background: planAllowsImport ? "#ffffff" : "#f1f5f9",
              }}
            />
          </div>

          <div style={{ display: "flex", gap: "12px", paddingTop: "16px", borderTop: "1px solid #f1f5f9" }}>
            <button
              type="submit"
              disabled={importing || !planAllowsImport}
              style={{
                background: "#2563eb",
                color: "#ffffff",
                border: "none",
                padding: "11px 24px",
                borderRadius: "8px",
                fontSize: "14px",
                fontWeight: "700",
                cursor: "pointer",
                boxShadow: "0 2px 6px rgba(37, 99, 235, 0.25)",
              }}
            >
              {importing ? "Processing CSV…" : "Start Bulk Import →"}
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
              Cancel
            </Link>
          </div>
        </Form>
      </div>
    </div>
  );
}
