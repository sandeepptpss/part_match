import { redirect } from "react-router";
const json = (data, init) => Response.json(data, init);
import { useLoaderData, Form, useActionData, useNavigation } from "react-router";
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
    <div style={{ padding: "20px", maxWidth: "800px", margin: "0 auto" }}>
      <a href="/app/fitment" style={{ color: "#2c6ecb", fontSize: "14px" }}>← Back to Fitment Records</a>

      <h1 style={{ fontSize: "22px", fontWeight: "700", margin: "16px 0 4px" }}>Import Fitment CSV</h1>
      <p style={{ color: "#6d7175", margin: "0 0 24px" }}>
        Paste or upload a CSV with columns: <strong>year, make, model, product_handle</strong> (product_handle is optional).
      </p>

      {actionData?.error && (
        <div style={{ background: "#f8d7da", color: "#721c24", padding: "12px 16px", borderRadius: "6px", marginBottom: "16px" }}>
          {actionData.error}
        </div>
      )}

      {actionData?.results && (
        <div style={{ background: "#d4edda", color: "#155724", padding: "16px", borderRadius: "6px", marginBottom: "20px" }}>
          <strong>Import Complete</strong>
          <ul style={{ margin: "8px 0 0", paddingLeft: "20px" }}>
            <li>Created / Updated: {actionData.results.created}</li>
            <li>Skipped: {actionData.results.skipped}</li>
          </ul>
          {actionData.results.errors.length > 0 && (
            <details style={{ marginTop: "8px" }}>
              <summary style={{ cursor: "pointer" }}>View {actionData.results.errors.length} error(s)</summary>
              <ul style={{ marginTop: "8px", color: "#856404" }}>
                {actionData.results.errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </details>
          )}
        </div>
      )}

      {/* Sample */}
      <details style={{ marginBottom: "20px" }}>
        <summary style={{ cursor: "pointer", color: "#2c6ecb", fontSize: "14px" }}>View sample CSV format</summary>
        <pre style={{ background: "#f6f6f7", padding: "12px", borderRadius: "6px", fontSize: "13px", marginTop: "8px", overflowX: "auto" }}>
          {sampleCSV}
        </pre>
      </details>

      {!planAllowsImport && (
        <div style={{ background: "#fff4e5", border: "1px solid #f5c99c", color: "#7a4a00", padding: "16px", borderRadius: "6px", marginBottom: "20px" }}>
          <strong>CSV Bulk Import is a Growth Professional feature.</strong>
          <p style={{ margin: "6px 0 8px" }}>Your current plan ({planLabel}) doesn&apos;t include CSV import. Upgrade to add records in bulk.</p>
          <a href="/app/plans" style={{ color: "#2c6ecb", fontWeight: "600" }}>View Plans →</a>
        </div>
      )}

      <Form method="post" aria-disabled={!planAllowsImport}>
        <div style={{ marginBottom: "16px" }}>
          <label style={{ display: "block", fontWeight: "500", marginBottom: "8px" }}>
            Paste CSV data
          </label>
          <textarea
            name="csv"
            rows={12}
            placeholder={sampleCSV}
            disabled={!planAllowsImport}
            style={{
              width: "100%",
              padding: "10px 12px",
              border: "1px solid #c9cccf",
              borderRadius: "6px",
              fontSize: "13px",
              fontFamily: "monospace",
              boxSizing: "border-box",
              resize: "vertical",
            }}
          />
        </div>

        <div style={{ display: "flex", gap: "12px" }}>
          <button
            type="submit"
            disabled={importing || !planAllowsImport}
            style={{
              background: "#2c6ecb",
              color: "#fff",
              border: "none",
              padding: "10px 20px",
              borderRadius: "6px",
              fontSize: "14px",
              fontWeight: "500",
              cursor: "pointer",
            }}
          >
            {importing ? "Importing…" : "Import CSV"}
          </button>
          <a
            href="/app/fitment"
            style={{
              display: "inline-block",
              background: "#f4f6f8",
              color: "#333",
              border: "1px solid #c9cccf",
              padding: "10px 20px",
              borderRadius: "6px",
              textDecoration: "none",
            }}
          >
            Cancel
          </a>
        </div>
      </Form>
    </div>
  );
}
