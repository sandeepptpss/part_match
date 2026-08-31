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
  const yearIdx = headers.indexOf("year");
  const makeIdx = headers.indexOf("make");
  const modelIdx = headers.indexOf("model");
  const handleIdx = headers.indexOf("product_handle");

  if (yearIdx === -1 || makeIdx === -1 || modelIdx === -1) {
    return json({
      error: `Missing required columns. Found: ${headers.join(", ")}. Required: year, make, model`,
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
    const handle = handleIdx >= 0 ? cols[handleIdx] : null;

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
        ? await prisma.fitmentRecord.findUnique({ where: { shop_year_make_model: { shop, year, make, model } } })
        : null;

      if (!existingRecord && Number.isFinite(limits.fitmentLimit) && recordCount >= limits.fitmentLimit) {
        limitReached = true;
        results.errors.push(`Row ${i + 1}: skipped — ${limits.fitmentLimit.toLocaleString()} fitment record limit for the ${limits.label} plan reached`);
        results.skipped++;
        continue;
      }

      const fitment = await prisma.fitmentRecord.upsert({
        where: { shop_year_make_model: { shop, year, make, model } },
        create: { shop, year, make, model },
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

  const sampleCSV = `year,make,model,product_handle
2025,Arctic Cat,Norseman 400,brake-pad-arctic-cat
2025,Arctic Cat,Norseman 400,oil-filter-arctic-cat
2024,Polaris,Sportsman 850,brake-pad-polaris
2024,Polaris,Sportsman 850,air-filter-polaris`;

  return (
    <div style={{ padding: "32px 24px", maxWidth: "860px", margin: "0 auto", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif", color: "#202223" }}>
      <Link to="/app/fitment" style={{ color: "#2563eb", fontSize: "14px", fontWeight: "600", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "4px", marginBottom: "20px" }}>
        ← Back to Fitment Catalog
      </Link>

      <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "16px", padding: "32px", boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.05)" }}>
        <div style={{ borderBottom: "1px solid #f1f5f9", paddingBottom: "20px", marginBottom: "24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
            <span style={{ fontSize: "24px" }}>📊</span>
            <h1 style={{ fontSize: "24px", fontWeight: "800", margin: 0, color: "#0f172a", letterSpacing: "-0.5px" }}>Bulk Import Fitments via CSV</h1>
          </div>
          <p style={{ color: "#64748b", margin: 0, fontSize: "14px" }}>
            Upload or paste CSV formatted vehicle fitments and optional Shopify product handles for batch creation.
          </p>
        </div>

        {actionData?.error && (
          <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", padding: "14px 18px", borderRadius: "10px", marginBottom: "24px", fontSize: "14px", fontWeight: "500" }}>
            ⚠️ {actionData.error}
          </div>
        )}

        {actionData?.results && (
          <div style={{ background: "#ecfdf5", border: "1px solid #a7f3d0", color: "#047857", padding: "20px", borderRadius: "12px", marginBottom: "24px" }}>
            <strong style={{ fontSize: "16px", display: "block", marginBottom: "8px" }}>🎉 Import Operation Complete</strong>
            <div style={{ display: "flex", gap: "16px", margin: "12px 0 0" }}>
              <span style={{ background: "#ffffff", padding: "6px 14px", borderRadius: "8px", fontWeight: "700", border: "1px solid #a7f3d0", fontSize: "13px" }}>
                ✓ Created / Updated: {actionData.results.created}
              </span>
              <span style={{ background: "#ffffff", padding: "6px 14px", borderRadius: "8px", fontWeight: "700", border: "1px solid #a7f3d0", fontSize: "13px", color: "#b45309" }}>
                ⚠️ Skipped: {actionData.results.skipped}
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

        {/* Sample */}
        <details style={{ marginBottom: "24px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "10px", padding: "12px 16px" }}>
          <summary style={{ cursor: "pointer", color: "#2563eb", fontSize: "14px", fontWeight: "700" }}>
            📄 View Standard CSV Header & Rows Format
          </summary>
          <pre style={{ background: "#0f172a", color: "#e2e8f0", padding: "16px", borderRadius: "8px", fontSize: "13px", marginTop: "12px", overflowX: "auto", fontFamily: "monospace" }}>
            {sampleCSV}
          </pre>
        </details>

        {!planAllowsImport && (
          <div style={{ background: "#fffbe6", border: "1px solid #ffe58f", color: "#78350f", padding: "20px", borderRadius: "12px", marginBottom: "24px" }}>
            <strong style={{ color: "#b45309", fontSize: "15px", display: "block", marginBottom: "4px" }}>🔒 Growth Professional Feature</strong>
            <p style={{ margin: "0 0 12px", fontSize: "14px" }}>
              Bulk CSV Import requires the Growth Professional plan. Upgrade to import thousands of records at once.
            </p>
            <Link to="/app/plans" style={{ color: "#2563eb", fontWeight: "700", fontSize: "14px", textDecoration: "none" }}>Upgrade Plan →</Link>
          </div>
        )}

        <Form method="post" aria-disabled={!planAllowsImport}>
          <div style={{ marginBottom: "20px" }}>
            <label style={{ display: "block", fontWeight: "700", color: "#1e293b", marginBottom: "8px", fontSize: "14px" }}>
              CSV Content Data
            </label>
            <textarea
              name="csv"
              rows={10}
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
                outline: "none",
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
