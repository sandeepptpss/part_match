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
      error: `CSV & ACES/PIES Bulk Import is available on the Growth Professional plan and above. Upgrade your plan to import records.`,
      results: null,
    });
  }

  const formData = await request.formData();
  let rawInput = formData.get("csv")?.toString() || "";

  if (!rawInput.trim()) {
    return json({ error: "No CSV or ACES/PIES XML data provided", results: null });
  }

  let cleanInput = rawInput.trim();
  if (cleanInput.startsWith("{") && cleanInput.includes('"csv"')) {
    try {
      const parsedJson = JSON.parse(cleanInput);
      if (parsedJson.csv) {
        cleanInput = parsedJson.csv.trim();
      }
    } catch (_) {}
  }
  rawInput = cleanInput;

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

  // Auto-detect XML format (ACES XML or PIES XML)
  if (rawInput.trim().startsWith("<")) {
    const appRegex = /<App[\s\S]*?<\/App>/gi;
    const matches = rawInput.match(appRegex) || [];

    if (matches.length === 0) {
      return json({
        error: "Invalid ACES XML format. No <App> fitment records found.",
        results: null,
      });
    }

    for (let i = 0; i < matches.length; i++) {
      const appBlock = matches[i];
      const getXmlTag = (tag) => {
        const match = appBlock.match(new RegExp(`<${tag}[^>]*>([^<]+)<\/${tag}>`, "i"));
        return match ? match[1].trim() : "";
      };

      const year = getXmlTag("Year") || getXmlTag("BaseVehicleYear") || getXmlTag("ModelYear");
      const make = getXmlTag("Make") || getXmlTag("MakeName");
      const model = getXmlTag("Model") || getXmlTag("ModelName");
      const trim = getXmlTag("SubModel") || getXmlTag("SubModelName") || getXmlTag("EngineBase") || getXmlTag("Trim");
      const partNumber = getXmlTag("Part") || getXmlTag("PartNumber") || getXmlTag("ItemNumber");

      if (!year || !make || !model) {
        results.errors.push(`XML Record ${i + 1}: Missing Year, Make, or Model`);
        results.skipped++;
        continue;
      }

      if (limitReached) {
        results.errors.push(`XML Record ${i + 1}: skipped — ${limits.fitmentLimit.toLocaleString()} fitment record limit reached`);
        results.skipped++;
        continue;
      }

      try {
        const existingRecord = Number.isFinite(limits.fitmentLimit)
          ? await prisma.fitmentRecord.findUnique({
              where: { shop_year_make_model_trim: { shop, year, make, model, trim: trim || "" } },
            })
          : null;

        if (!existingRecord && Number.isFinite(limits.fitmentLimit) && recordCount >= limits.fitmentLimit) {
          limitReached = true;
          results.errors.push(`XML Record ${i + 1}: skipped — ${limits.fitmentLimit.toLocaleString()} fitment limit reached`);
          results.skipped++;
          continue;
        }

        const fitment = await prisma.fitmentRecord.upsert({
          where: { shop_year_make_model_trim: { shop, year, make, model, trim: trim || "" } },
          create: { shop, year, make, model, trim: trim || "" },
          update: {},
        });
        if (!existingRecord) recordCount++;

        if (partNumber) {
          const product = await resolveHandle(partNumber.toLowerCase());
          if (product) {
            await prisma.fitmentProduct.upsert({
              where: { fitmentId_shopifyProductId: { fitmentId: fitment.id, shopifyProductId: product.id } },
              create: { fitmentId: fitment.id, shopifyProductId: product.id, shopifyHandle: product.handle, productTitle: product.title },
              update: { shopifyHandle: product.handle, productTitle: product.title },
            });
          } else {
            await prisma.fitmentSku.upsert({
              where: { fitmentId_sku: { fitmentId: fitment.id, sku: partNumber } },
              create: { fitmentId: fitment.id, sku: partNumber },
              update: {},
            });
          }
        }
        results.created++;
      } catch (err) {
        results.errors.push(`XML Record ${i + 1}: ${err.message}`);
        results.skipped++;
      }
    }

    return json({ error: null, results });
  }

  // Parse CSV format
  const lines = rawInput.trim().split("\n").filter((l) => l.trim());
  if (lines.length < 2) {
    return json({
      error: "The uploaded CSV file contains only a header row without any fitment data rows. Please add fitment data rows below the header line.",
      results: null,
    });
  }

  // Parse header - 1-Click Competitor Auto-Detection (Easy YMM, Fitment Group, Smart Search, Simple YMM, ACES)
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/["']/g, ""));
  let yearIdx = headers.findIndex((h) => ["year", "yearid", "modelyear", "model_year", "yyyy"].includes(h));
  let makeIdx = headers.findIndex((h) => ["make", "makename", "make_name", "manufacturer", "brand"].includes(h));
  let modelIdx = headers.findIndex((h) => ["model", "modelname", "model_name", "vehicle_model"].includes(h));
  let trimIdx = headers.findIndex((h) => ["trim", "submodel", "submodelname", "enginebase", "sub_model", "engine", "trim_level"].includes(h));
  let handleIdx = headers.findIndex((h) => ["product_handle", "handle", "product handle", "partnumber", "partno", "part_number", "itemnumber", "product_sku", "shopify_handle"].includes(h));
  const collectionIdx = headers.findIndex((h) => ["collection_handle", "collection", "collection_slug"].includes(h));
  const tagIdx = headers.findIndex((h) => ["tag", "tags", "fitment_tag"].includes(h));
  const skuIdx = headers.findIndex((h) => ["sku", "variant_sku", "part_sku", "variant sku"].includes(h));

  if (yearIdx === -1 || makeIdx === -1 || modelIdx === -1) {
    return json({
      error: `Missing required columns. Found: ${headers.join(", ")}. Supported headers: Year (or ModelYear/YearID), Make (or MakeName), Model (or ModelName), PartNumber/Handle/SKU (Supports Easy YMM, Fitment Group & Smart Search exports)`,
      results: null,
    });
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
          await prisma.fitmentSku.upsert({
            where: { fitmentId_sku: { fitmentId: fitment.id, sku: handle } },
            create: { fitmentId: fitment.id, sku: handle },
            update: {},
          });
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

  const [acesInput, setAcesInput] = useState("");
  const [convertedCsv, setConvertedCsv] = useState("");
  const [conversionStatus, setConversionStatus] = useState(null);
  const [dismissActionError, setDismissActionError] = useState(false);

  const convertAcesToCsv = () => {
    if (!acesInput.trim()) {
      setConversionStatus({ type: "error", message: "Please paste ACES/PIES XML or CSV data to convert." });
      return;
    }

    try {
      let rows = [["year", "make", "model", "trim", "product_handle", "product_title", "collection_handle", "tag", "sku"]];
      let input = acesInput.trim();

      if (input.startsWith("<") || input.includes("<ACES") || input.includes("<App")) {
        const appBlocks = input.match(/<App[\s\S]*?<\/App>/gi) || [];
        if (appBlocks.length === 0) {
          setConversionStatus({ type: "error", message: "No <App> XML elements found in ACES content." });
          return;
        }

        appBlocks.forEach(appBlock => {
          const getTag = (tag) => {
            const match = appBlock.match(new RegExp(`<${tag}[^>]*>([^<]+)<\/${tag}>`, "i"));
            return match ? match[1].trim() : "";
          };
          const year = getTag("Year") || getTag("BaseVehicleYear") || getTag("ModelYear");
          const make = getTag("Make") || getTag("MakeName");
          const model = getTag("Model") || getTag("ModelName");
          const trim = getTag("SubModel") || getTag("SubModelName") || getTag("EngineBase") || getTag("Trim");
          const part = getTag("Part") || getTag("PartNumber") || getTag("ItemNumber");

          if (year && make && model) {
            rows.push([year, make, model, trim, part, "", "", "", part]);
          }
        });
      } else {
        const lines = input.split("\n").filter(l => l.trim());
        if (lines.length > 1) {
          const headers = lines[0].split(",").map(h => h.trim().toLowerCase().replace(/["']/g, ""));
          const yearIdx = headers.findIndex(h => ["year", "yearid", "modelyear", "basevehicleyear", "model_year", "yyyy"].includes(h));
          const makeIdx = headers.findIndex(h => ["make", "makename", "make_name", "brand", "manufacturer"].includes(h));
          const modelIdx = headers.findIndex(h => ["model", "modelname", "model_name", "vehicle_model"].includes(h));
          const trimIdx = headers.findIndex(h => ["trim", "submodel", "submodelname", "sub_model", "enginebase", "engine"].includes(h));
          const partIdx = headers.findIndex(h => ["partnumber", "part_number", "part", "partno", "sku", "itemnumber", "product_sku", "handle"].includes(h));

          for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(",").map(c => c.trim().replace(/^["']|["']$/g, ""));
            const year = yearIdx >= 0 ? cols[yearIdx] : "";
            const make = makeIdx >= 0 ? cols[makeIdx] : "";
            const model = modelIdx >= 0 ? cols[modelIdx] : "";
            const trim = trimIdx >= 0 ? cols[trimIdx] || "" : "";
            const part = partIdx >= 0 ? cols[partIdx] || "" : "";

            if (year && make && model) {
              rows.push([year, make, model, trim, part, "", "", "", part]);
            }
          }
        }
      }

      if (rows.length <= 1) {
        setConversionStatus({ type: "error", message: "Could not extract valid ACES records. Please check your XML or CSV format." });
        return;
      }

      const generatedCsv = rows.map(r => r.map(cell => `"${(cell || "").replace(/"/g, '""')}"`).join(",")).join("\n");
      setConvertedCsv(generatedCsv);
      setCsvContent(generatedCsv);
      setFileName("converted_aces_partmatch.csv");
      setConversionStatus({ type: "success", count: rows.length - 1 });
    } catch (err) {
      setConversionStatus({ type: "error", message: `Conversion error: ${err.message}` });
    }
  };

  const sampleCSV = `year,make,model,trim,product_handle,product_title,collection_handle,tag,sku
2025,Arctic Cat,Norseman 400,Base,brake-pad-arctic-cat,Brake Pad Arctic Cat,,,
2025,Arctic Cat,Norseman 400,LX,,,arctic-cat-parts,,
2024,Polaris,Sportsman 850,SP,,,,polaris-sportsman-2024,
2026,BMW,M3,Base,,,,SKU-BMW-M3-2026`;

  const sampleACES = `YearID,MakeName,ModelName,SubModelName,PartNumber,BrandID
2025,Ford,F-150,XL,BP-FORD-F150-2025,MOTORCRAFT
2024,Chevrolet,Silverado 1500,LT,BRK-CHEVY-2024,ACDELCO
2026,Toyota,Camry,SE,OIL-TOY-CAMRY-2026,DENSO`;

  const sampleACESXML = `<?xml version="1.0" encoding="utf-8"?>
<ACES version="3.2">
  <Header>
    <Company>AutoParts Enterprise</Company>
    <SenderName>PartMatch Export</SenderName>
  </Header>
  <App action="A" id="1">
    <BaseVehicleYear>2025</BaseVehicleYear>
    <MakeName>Ford</MakeName>
    <ModelName>F-150</ModelName>
    <SubModelName>XL 3.5L V6</SubModelName>
    <PartNumber>BP-FORD-F150-2025</PartNumber>
  </App>
  <App action="A" id="2">
    <BaseVehicleYear>2024</BaseVehicleYear>
    <MakeName>BMW</MakeName>
    <ModelName>M3</ModelName>
    <SubModelName>Competition 3.0L</SubModelName>
    <PartNumber>bmw-m3-brake-rotors</PartNumber>
  </App>
</ACES>`;

  const handleFileUpload = (file) => {
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      let content = (e.target?.result || "").toString().replace(/^\uFEFF/, "");
      let trimmed = content.trim();
      if (trimmed.startsWith("{") && trimmed.includes('"csv"')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.csv) content = parsed.csv;
        } catch (_) {}
      }
      setCsvContent(content);
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

  const downloadFile = (content, filename, type) => {
    const isCsv = type.includes("csv") || filename.endsWith(".csv");
    const finalContent = isCsv && !content.startsWith("\uFEFF") ? "\uFEFF" + content : content;
    const blob = new Blob([finalContent], { type: `${type};charset=utf-8;` });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ padding: "32px 24px 60px", maxWidth: "920px", margin: "0 auto", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif", color: "#0f172a" }}>
      {/* Top Breadcrumb Navigation */}
      <div style={{ marginBottom: "20px" }}>
        <Link to="/app/fitment" style={{ color: "#475569", fontSize: "14px", fontWeight: "600", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "6px" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"></line>
            <polyline points="12 19 5 12 12 5"></polyline>
          </svg>
          Back to Fitment Catalog
        </Link>
      </div>

      {/* Executive Hero Banner */}
      <div style={{
        background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
        borderRadius: "16px",
        padding: "28px 32px",
        color: "#ffffff",
        marginBottom: "24px",
        boxShadow: "0 10px 25px -5px rgba(15, 23, 42, 0.15)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: "16px"
      }}>
        <div style={{ maxWidth: "600px" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "rgba(255, 255, 255, 0.1)", padding: "4px 10px", borderRadius: "6px", fontSize: "12px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "10px", color: "#cbd5e1" }}>
            Bulk Management Engine
          </div>
          <h1 style={{ fontSize: "26px", fontWeight: "800", margin: "0 0 6px", color: "#ffffff", letterSpacing: "-0.5px" }}>
            Bulk Import Fitments
          </h1>
          <p style={{ color: "#94a3b8", margin: 0, fontSize: "14px", lineHeight: "1.5" }}>
            Upload standard PartMatch CSV files or North American Enterprise <strong>ACES / PIES (XML & CSV)</strong> automotive catalog records.
          </p>
        </div>

        <div style={{ background: "rgba(16, 185, 129, 0.15)", border: "1px solid rgba(16, 185, 129, 0.3)", borderRadius: "12px", padding: "10px 16px", textAlign: "right" }}>
          <div style={{ color: "#34d399", fontSize: "11px", fontWeight: "800", textTransform: "uppercase", letterSpacing: "0.5px" }}>Auto-Detection Active</div>
          <div style={{ color: "#ffffff", fontSize: "13px", fontWeight: "700", marginTop: "2px" }}>ACES / PIES Ready</div>
        </div>
      </div>

      {/* Main Container */}
      <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "16px", padding: "32px", boxShadow: "0 4px 20px -2px rgba(0, 0, 0, 0.03)" }}>
        
        {actionData?.error && !dismissActionError && (
          <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", padding: "16px 20px", borderRadius: "12px", marginBottom: "24px", fontSize: "14px", fontWeight: "500", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
            <div>
              <span style={{ fontWeight: "700" }}>Error:</span> {actionData.error}
            </div>
            <button
              type="button"
              onClick={() => setDismissActionError(true)}
              style={{ background: "none", border: "none", color: "#991b1b", fontSize: "16px", fontWeight: "800", cursor: "pointer", padding: "2px 6px" }}
              title="Dismiss error"
            >
              ✕
            </button>
          </div>
        )}

        {actionData?.results && (
          <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", color: "#166534", padding: "20px 24px", borderRadius: "14px", marginBottom: "28px" }}>
            <div style={{ fontSize: "16px", fontWeight: "800", color: "#15803d", marginBottom: "8px" }}>
              Import Operation Complete
            </div>
            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", margin: "10px 0 0" }}>
              <span style={{ background: "#ffffff", color: "#15803d", padding: "6px 14px", borderRadius: "8px", fontWeight: "700", border: "1px solid #86efac", fontSize: "13px" }}>
                Created / Updated: {actionData.results.created}
              </span>
              <span style={{ background: "#ffffff", color: "#b45309", padding: "6px 14px", borderRadius: "8px", fontWeight: "700", border: "1px solid #fde68a", fontSize: "13px" }}>
                Skipped: {actionData.results.skipped}
              </span>
            </div>
            {actionData.results.errors.length > 0 && (
              <details style={{ marginTop: "14px" }}>
                <summary style={{ cursor: "pointer", fontWeight: "700", fontSize: "13px", color: "#92400e" }}>
                  View {actionData.results.errors.length} warning / error details
                </summary>
                <ul style={{ marginTop: "10px", color: "#b45309", fontSize: "13px", paddingLeft: "20px" }}>
                  {actionData.results.errors.map((e, i) => <li key={i} style={{ marginBottom: "4px" }}>{e}</li>)}
                </ul>
              </details>
            )}
          </div>
        )}

        {/* Step 1: Download Templates */}
        <div style={{ marginBottom: "32px", paddingBottom: "28px", borderBottom: "1px solid #f1f5f9" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
            <span style={{ background: "#e2e8f0", color: "#334155", fontSize: "12px", fontWeight: "800", padding: "4px 8px", borderRadius: "6px" }}>STEP 1</span>
            <h2 style={{ fontSize: "15px", fontWeight: "700", color: "#0f172a", margin: 0 }}>Download Catalog Templates</h2>
          </div>
          
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "12px" }}>
            {/* Template Card 1 */}
            <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "12px", padding: "16px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: "14px", fontWeight: "700", color: "#0f172a", marginBottom: "4px" }}>Standard PartMatch CSV</div>
                <div style={{ fontSize: "12px", color: "#64748b", marginBottom: "14px" }}>Default 9-column fitment catalog format</div>
              </div>
              <button
                type="button"
                onClick={() => downloadFile(sampleCSV, "partmatch_sample.csv", "text/csv")}
                style={{ background: "#ffffff", color: "#0f172a", border: "1px solid #cbd5e1", padding: "9px 14px", borderRadius: "8px", fontSize: "13px", fontWeight: "700", cursor: "pointer", width: "100%", textAlign: "center" }}
              >
                Download Standard CSV
              </button>
            </div>

            {/* Template Card 2 */}
            <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "12px", padding: "16px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: "14px", fontWeight: "700", color: "#166534", marginBottom: "4px" }}>ACES Standard CSV</div>
                <div style={{ fontSize: "12px", color: "#15803d", marginBottom: "14px" }}>North American ACES vehicle mappings</div>
              </div>
              <button
                type="button"
                onClick={() => downloadFile(sampleACES, "aces_fitment_sample.csv", "text/csv")}
                style={{ background: "#ffffff", color: "#15803d", border: "1px solid #86efac", padding: "9px 14px", borderRadius: "8px", fontSize: "13px", fontWeight: "700", cursor: "pointer", width: "100%", textAlign: "center" }}
              >
                Download ACES CSV
              </button>
            </div>

            {/* Template Card 3 */}
            <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: "12px", padding: "16px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: "14px", fontWeight: "700", color: "#1e40af", marginBottom: "4px" }}>ACES Enterprise XML</div>
                <div style={{ fontSize: "12px", color: "#1d4ed8", marginBottom: "14px" }}>Industry ACES 3.2 XML catalog specification</div>
              </div>
              <button
                type="button"
                onClick={() => downloadFile(sampleACESXML, "aces_catalog_sample.xml", "application/xml")}
                style={{ background: "#ffffff", color: "#1d4ed8", border: "1px solid #93c5fd", padding: "9px 14px", borderRadius: "8px", fontSize: "13px", fontWeight: "700", cursor: "pointer", width: "100%", textAlign: "center" }}
              >
                Download ACES XML
              </button>
            </div>
          </div>
        </div>

        {/* ACES/PIES 1-Click Interactive Converter */}
        <div style={{ background: "#f8fafc", border: "1px solid #cbd5e1", borderRadius: "14px", padding: "24px", marginBottom: "32px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px", flexWrap: "wrap", gap: "8px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ background: "#2563eb", color: "#ffffff", fontSize: "11px", fontWeight: "800", padding: "3px 8px", borderRadius: "6px" }}>NEW</span>
              <h3 style={{ fontSize: "16px", fontWeight: "700", color: "#0f172a", margin: 0 }}>ACES / PIES 1-Click Converter Tool</h3>
            </div>
            <span style={{ fontSize: "12px", color: "#64748b" }}>Convert raw ACES/PIES XML or CSV into PartMatch CSV format</span>
          </div>

          <p style={{ fontSize: "13px", color: "#475569", margin: "0 0 14px", lineHeight: "1.4" }}>
            Paste raw ACES XML or ACES CSV catalog data below to instantly convert it into clean PartMatch CSV format ready for bulk import.
          </p>

          <textarea
            rows={4}
            value={acesInput}
            onChange={(e) => setAcesInput(e.target.value)}
            placeholder="Paste raw ACES XML (<App>...</App>) or ACES CSV content here..."
            style={{
              width: "100%",
              padding: "12px",
              border: "1px solid #cbd5e1",
              borderRadius: "8px",
              fontSize: "12px",
              fontFamily: "monospace",
              boxSizing: "border-box",
              marginBottom: "12px",
              background: "#ffffff"
            }}
          />

          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
            <button
              type="button"
              onClick={convertAcesToCsv}
              style={{ background: "#0f172a", color: "#ffffff", border: "none", padding: "8px 18px", borderRadius: "8px", fontSize: "13px", fontWeight: "700", cursor: "pointer" }}
            >
              Convert ACES / PIES →
            </button>
            {convertedCsv && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setCsvContent(convertedCsv);
                    setFileName("converted_aces_partmatch.csv");
                  }}
                  style={{ background: "#166534", color: "#ffffff", border: "none", padding: "8px 18px", borderRadius: "8px", fontSize: "13px", fontWeight: "700", cursor: "pointer" }}
                >
                  Load Converted CSV into Import Editor Below ✓
                </button>
                <button
                  type="button"
                  onClick={() => downloadFile(convertedCsv, "converted_aces_partmatch.csv", "text/csv")}
                  style={{ background: "#ffffff", color: "#166534", border: "1px solid #86efac", padding: "8px 16px", borderRadius: "8px", fontSize: "13px", fontWeight: "700", cursor: "pointer" }}
                >
                  Download Converted CSV
                </button>
              </>
            )}
          </div>

          {conversionStatus && (
            <div style={{
              marginTop: "14px",
              padding: "10px 14px",
              borderRadius: "8px",
              fontSize: "13px",
              fontWeight: "600",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "10px",
              background: conversionStatus.type === "success" ? "#f0fdf4" : "#fef2f2",
              border: `1px solid ${conversionStatus.type === "success" ? "#bbf7d0" : "#fecaca"}`,
              color: conversionStatus.type === "success" ? "#15803d" : "#991b1b"
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span>{conversionStatus.type === "success" ? "✓" : "!"}</span>
                <span>
                  {conversionStatus.type === "success"
                    ? `Successfully converted ${conversionStatus.count} ACES records into PartMatch CSV!`
                    : conversionStatus.message}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setConversionStatus(null)}
                style={{
                  background: "none",
                  border: "none",
                  color: conversionStatus.type === "success" ? "#15803d" : "#991b1b",
                  fontSize: "16px",
                  fontWeight: "800",
                  cursor: "pointer",
                  padding: "2px 6px",
                  borderRadius: "4px",
                  lineHeight: "1"
                }}
                title="Dismiss message"
              >
                ✕
              </button>
            </div>
          )}
        </div>

        {!planAllowsImport && (
          <div style={{ background: "#fffbe6", border: "1px solid #ffe58f", color: "#78350f", padding: "20px", borderRadius: "12px", marginBottom: "28px" }}>
            <strong style={{ color: "#b45309", fontSize: "15px", display: "block", marginBottom: "4px" }}>Growth Professional Feature</strong>
            <p style={{ margin: "0 0 12px", fontSize: "14px" }}>
              Bulk CSV Import requires the Growth Professional plan. Upgrade to import thousands of records at once.
            </p>
            <Link to="/app/plans" style={{ color: "#2563eb", fontWeight: "700", fontSize: "14px", textDecoration: "none" }}>Upgrade Plan →</Link>
          </div>
        )}

        {/* Step 2: Upload File & Paste Area */}
        <div style={{ marginBottom: "28px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
            <span style={{ background: "#e2e8f0", color: "#334155", fontSize: "12px", fontWeight: "800", padding: "4px 8px", borderRadius: "6px" }}>STEP 2</span>
            <h2 style={{ fontSize: "15px", fontWeight: "700", color: "#0f172a", margin: 0 }}>Upload File or Paste Data</h2>
          </div>

          {/* Upload Dropzone */}
          <div
            onClick={() => {
              if (planAllowsImport) document.getElementById("csvFileInput")?.click();
            }}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            style={{
              border: isDragging ? "2px dashed #2563eb" : "2px dashed #cbd5e1",
              background: isDragging ? "#eff6ff" : "#f8fafc",
              borderRadius: "14px",
              padding: "28px 20px",
              textAlign: "center",
              cursor: planAllowsImport ? "pointer" : "not-allowed",
              transition: "all 0.2s ease",
              marginBottom: "20px"
            }}
          >
            <input
              type="file"
              accept=".csv,.xml"
              disabled={!planAllowsImport}
              id="csvFileInput"
              onChange={(e) => handleFileUpload(e.target.files?.[0])}
              style={{ display: "none" }}
            />
            <label htmlFor="csvFileInput" style={{ cursor: planAllowsImport ? "pointer" : "not-allowed", display: "block" }}>
              <div style={{ width: "48px", height: "48px", background: "#dbeafe", color: "#2563eb", borderRadius: "12px", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="17 8 12 3 7 8"></polyline>
                  <line x1="12" y1="3" x2="12" y2="15"></line>
                </svg>
              </div>
              <div style={{ fontSize: "15px", fontWeight: "700", color: "#1e293b", marginBottom: "4px" }}>
                {fileName ? `Selected File: ${fileName}` : "Click to Browse or Drag & Drop File Here"}
              </div>
              <div style={{ fontSize: "13px", color: "#64748b" }}>
                Supports CSV or ACES / PIES XML format (.csv, .xml)
              </div>
            </label>
          </div>

          {/* Form and Direct Textarea */}
          <Form method="post">
            <div style={{ marginBottom: "24px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                <label style={{ fontWeight: "700", color: "#1e293b", fontSize: "13px" }}>
                  Data Content Preview / Manual Editor
                </label>
                {csvContent && (
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <span style={{ fontSize: "12px", color: "#059669", fontWeight: "700", background: "#ecfdf5", padding: "2px 8px", borderRadius: "6px", border: "1px solid #a7f3d0" }}>
                      ✓ {csvContent.trim().split("\n").length} Lines Loaded
                    </span>
                    <button
                      type="button"
                      onClick={() => { setCsvContent(""); setFileName(""); setConvertedCsv(""); }}
                      style={{ background: "none", border: "none", color: "#ef4444", fontSize: "12px", fontWeight: "700", cursor: "pointer" }}
                    >
                      Clear Content
                    </button>
                  </div>
                )}
              </div>
              <textarea
                name="csv"
                rows={9}
                value={csvContent}
                onChange={(e) => setCsvContent(e.target.value)}
                placeholder={sampleCSV}
                disabled={!planAllowsImport}
                style={{
                  width: "100%",
                  padding: "14px",
                  border: "1px solid #cbd5e1",
                  borderRadius: "12px",
                  fontSize: "13px",
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                  boxSizing: "border-box",
                  resize: "vertical",
                  lineHeight: "1.5",
                  background: planAllowsImport ? "#ffffff" : "#f1f5f9",
                  color: "#0f172a"
                }}
              />
            </div>

            {/* Action Bar */}
            <div style={{ display: "flex", gap: "12px", alignItems: "center", paddingTop: "20px", borderTop: "1px solid #f1f5f9" }}>
              <button
                type="submit"
                disabled={importing || !planAllowsImport}
                style={{
                  background: "#2563eb",
                  color: "#ffffff",
                  border: "none",
                  padding: "12px 28px",
                  borderRadius: "10px",
                  fontSize: "14px",
                  fontWeight: "700",
                  cursor: importing || !planAllowsImport ? "not-allowed" : "pointer",
                  opacity: importing || !planAllowsImport ? 0.7 : 1,
                  boxShadow: "0 4px 12px rgba(37, 99, 235, 0.25)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px"
                }}
              >
                {importing ? "Processing Catalog Data…" : "Start Bulk Import →"}
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
                  borderRadius: "10px",
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
    </div>
  );
}
